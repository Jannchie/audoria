<script setup lang="ts">
import type { ContextMenuItem } from '../composables/useContextMenu'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useContextMenu } from '../composables/useContextMenu'

const { close, trigger, visible } = useContextMenu()

const rootRef = ref<HTMLElement | null>(null)
const submenuRef = ref<HTMLElement | null>(null)
const position = ref({ left: 0, top: 0 })
const hoverPath = ref<number[]>([])
const dynamicSubmenus = shallowRef<Map<string, ContextMenuItem[]>>(new Map())
const submenuLoading = ref<string | null>(null)
const submenuPosition = ref({ left: 0, top: 0 })

const items = computed<ContextMenuItem[]>(() => trigger.value?.items ?? [])

const hoveredRoot = computed(() => {
  const first = hoverPath.value[0]
  if (first === undefined) {
    return null
  }
  return items.value[first] ?? null
})

const hoveredRootSubmenu = computed<ContextMenuItem[] | null>(() => {
  const item = hoveredRoot.value
  if (!item?.submenu) {
    return null
  }
  if (Array.isArray(item.submenu)) {
    return item.submenu
  }
  return dynamicSubmenus.value.get(item.id) ?? null
})

async function positionMenu(): Promise<void> {
  await nextTick()
  const root = rootRef.value
  if (!root || !trigger.value) {
    return
  }
  const { x, y } = trigger.value
  const rect = root.getBoundingClientRect()
  const viewportW = globalThis.innerWidth
  const viewportH = globalThis.innerHeight
  const padding = 8
  let left = x
  let top = y
  if (left + rect.width + padding > viewportW) {
    left = Math.max(padding, viewportW - rect.width - padding)
  }
  if (top + rect.height + padding > viewportH) {
    top = Math.max(padding, viewportH - rect.height - padding)
  }
  if (left < padding) {
    left = padding
  }
  if (top < padding) {
    top = padding
  }
  position.value = { left, top }
}

async function positionSubmenu(rootItemIndex: number): Promise<void> {
  await nextTick()
  const root = rootRef.value
  const submenu = submenuRef.value
  if (!root || !submenu) {
    return
  }
  const itemEl = root.querySelector<HTMLElement>(`[data-menu-index="${rootItemIndex}"]`)
  if (!itemEl) {
    return
  }
  const itemRect = itemEl.getBoundingClientRect()
  const subRect = submenu.getBoundingClientRect()
  const viewportW = globalThis.innerWidth
  const viewportH = globalThis.innerHeight
  const padding = 8
  let left = itemRect.right + 2
  let top = itemRect.top - 4
  if (left + subRect.width + padding > viewportW) {
    left = Math.max(padding, itemRect.left - subRect.width - 2)
  }
  if (top + subRect.height + padding > viewportH) {
    top = Math.max(padding, viewportH - subRect.height - padding)
  }
  submenuPosition.value = { left, top }
}

async function loadDynamicSubmenu(item: ContextMenuItem): Promise<void> {
  if (!item.submenu || typeof item.submenu !== 'function') {
    return
  }
  if (dynamicSubmenus.value.has(item.id)) {
    return
  }
  submenuLoading.value = item.id
  try {
    const result = await item.submenu()
    const next = new Map(dynamicSubmenus.value)
    next.set(item.id, result)
    dynamicSubmenus.value = next
  }
  finally {
    if (submenuLoading.value === item.id) {
      submenuLoading.value = null
    }
  }
}

function hoverRoot(index: number, item: ContextMenuItem): void {
  if (item.disabled || item.divider) {
    hoverPath.value = [index]
    return
  }
  hoverPath.value = [index]
  if (item.submenu) {
    if (typeof item.submenu === 'function') {
      void loadDynamicSubmenu(item)
    }
    void positionSubmenu(index)
  }
}

async function invoke(item: ContextMenuItem): Promise<void> {
  if (item.disabled || item.divider || item.submenu) {
    return
  }
  try {
    await item.onSelect?.()
  }
  finally {
    close()
  }
}

function handleOutsidePointer(event: PointerEvent): void {
  if (!visible.value) {
    return
  }
  const root = rootRef.value
  const submenu = submenuRef.value
  const target = event.target as Node | null
  if (root?.contains(target ?? null)) {
    return
  }
  if (submenu?.contains(target ?? null)) {
    return
  }
  close()
}

function handleKey(event: KeyboardEvent): void {
  if (!visible.value) {
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

watch(visible, async (isVisible) => {
  if (!isVisible) {
    hoverPath.value = []
    dynamicSubmenus.value = new Map()
    submenuLoading.value = null
    return
  }
  await positionMenu()
  globalThis.addEventListener('pointerdown', handleOutsidePointer, true)
  globalThis.addEventListener('keydown', handleKey)
  globalThis.addEventListener('scroll', close, true)
  globalThis.addEventListener('resize', close)
})

watch(visible, (isVisible) => {
  if (isVisible) {
    return
  }
  globalThis.removeEventListener('pointerdown', handleOutsidePointer, true)
  globalThis.removeEventListener('keydown', handleKey)
  globalThis.removeEventListener('scroll', close, true)
  globalThis.removeEventListener('resize', close)
})

watch(hoveredRootSubmenu, async (submenu) => {
  if (!submenu || hoverPath.value.length === 0) {
    return
  }
  await positionSubmenu(hoverPath.value[0])
})

onBeforeUnmount(() => {
  globalThis.removeEventListener('pointerdown', handleOutsidePointer, true)
  globalThis.removeEventListener('keydown', handleKey)
  globalThis.removeEventListener('scroll', close, true)
  globalThis.removeEventListener('resize', close)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="ctx-menu-fade">
      <div
        v-if="visible"
        class="ctx-menu-layer"
        @contextmenu.prevent
      >
        <ul
          ref="rootRef"
          class="ctx-menu"
          role="menu"
          :style="{ left: `${position.left}px`, top: `${position.top}px` }"
        >
          <template
            v-for="(item, index) in items"
            :key="item.id"
          >
            <li
              v-if="item.divider"
              class="ctx-menu-divider"
              role="separator"
            />
            <li
              v-else
              class="ctx-menu-item"
              :class="{
                'ctx-menu-item--disabled': item.disabled,
                'ctx-menu-item--danger': item.danger,
                'ctx-menu-item--has-sub': !!item.submenu,
                'ctx-menu-item--active': hoverPath[0] === index,
              }"
              :data-menu-index="index"
              role="menuitem"
              :aria-disabled="item.disabled"
              :aria-haspopup="item.submenu ? 'menu' : undefined"
              @mouseenter="hoverRoot(index, item)"
              @click="invoke(item)"
            >
              <span
                class="ctx-menu-icon"
                :class="item.icon"
                aria-hidden="true"
              />
              <span class="ctx-menu-label">{{ item.label }}</span>
              <span
                v-if="item.shortcut"
                class="ctx-menu-shortcut"
              >{{ item.shortcut }}</span>
              <span
                v-if="item.submenu"
                class="ctx-menu-caret i-tabler-chevron-right"
                aria-hidden="true"
              />
            </li>
          </template>
        </ul>

        <ul
          v-if="hoveredRoot?.submenu"
          ref="submenuRef"
          class="ctx-menu ctx-menu--submenu"
          role="menu"
          :style="{ left: `${submenuPosition.left}px`, top: `${submenuPosition.top}px` }"
        >
          <li
            v-if="submenuLoading === hoveredRoot.id"
            class="ctx-menu-item ctx-menu-item--disabled"
          >
            <span
              class="ctx-menu-icon i-tabler-loader-2 animate-spin"
              aria-hidden="true"
            />
            <span class="ctx-menu-label">Loading...</span>
          </li>
          <template v-else-if="hoveredRootSubmenu && hoveredRootSubmenu.length > 0">
            <template
              v-for="sub in hoveredRootSubmenu"
              :key="sub.id"
            >
              <li
                v-if="sub.divider"
                class="ctx-menu-divider"
                role="separator"
              />
              <li
                v-else
                class="ctx-menu-item"
                :class="{
                  'ctx-menu-item--disabled': sub.disabled,
                  'ctx-menu-item--danger': sub.danger,
                }"
                role="menuitem"
                :aria-disabled="sub.disabled"
                @click.stop="invoke(sub)"
              >
                <span
                  class="ctx-menu-icon"
                  :class="sub.icon"
                  aria-hidden="true"
                />
                <span class="ctx-menu-label">{{ sub.label }}</span>
                <span
                  v-if="sub.shortcut"
                  class="ctx-menu-shortcut"
                >{{ sub.shortcut }}</span>
              </li>
            </template>
          </template>
          <li
            v-else
            class="ctx-menu-item ctx-menu-item--disabled"
          >
            <span class="ctx-menu-label">No items</span>
          </li>
        </ul>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ctx-menu-layer {
  position: fixed;
  inset: 0;
  z-index: 120;
  pointer-events: none;
}

.ctx-menu {
  pointer-events: auto;
  position: fixed;
  margin: 0;
  padding: 0.25rem;
  list-style: none;
  min-width: 11rem;
  max-width: 20rem;
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
  background: var(--bg-elevated, var(--bg-surface));
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28), 0 4px 16px rgba(0, 0, 0, 0.18);
  font-size: 0.8125rem;
  color: var(--text-primary);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
}

.ctx-menu--submenu {
  min-width: 12rem;
}

.ctx-menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 1.875rem;
  padding: 0.25rem 0.625rem;
  border-radius: 0.375rem;
  cursor: pointer;
  user-select: none;
  color: var(--text-primary);
  transition: background 0.12s ease, color 0.12s ease;
}

.ctx-menu-item:hover,
.ctx-menu-item--active {
  background: var(--bg-surface);
}

.ctx-menu-item--disabled {
  color: var(--text-tertiary);
  cursor: default;
  pointer-events: none;
}

.ctx-menu-item--danger {
  color: var(--danger);
}

.ctx-menu-item--danger:hover,
.ctx-menu-item--danger.ctx-menu-item--active {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}

.ctx-menu-icon {
  display: inline-flex;
  flex-shrink: 0;
  width: 1rem;
  height: 1rem;
  font-size: 0.9375rem;
  color: currentColor;
  opacity: 0.85;
}

.ctx-menu-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ctx-menu-shortcut {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  letter-spacing: 0.02em;
}

.ctx-menu-caret {
  flex-shrink: 0;
  font-size: 0.875rem;
  color: var(--text-tertiary);
}

.ctx-menu-divider {
  height: 1px;
  margin: 0.25rem 0.375rem;
  background: var(--border);
}

.ctx-menu-fade-enter-active,
.ctx-menu-fade-leave-active {
  transition: opacity 0.1s ease;
}

.ctx-menu-fade-enter-from,
.ctx-menu-fade-leave-to {
  opacity: 0;
}
</style>
