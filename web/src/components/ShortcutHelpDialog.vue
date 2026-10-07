<script setup lang="ts">
import type { ShortcutDefinition, ShortcutGroup } from '../utils/shortcuts'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDialogFocus } from '../composables/useDialogFocus'
import { shortcutRegistry, useShortcutHelp } from '../composables/useKeyboardShortcuts'
import { detectMac, formatCombo } from '../utils/shortcuts'

const { t } = useI18n()
const { isOpen, close } = useShortcutHelp()
const panelRef = ref<HTMLElement | null>(null)
const { onKeydown } = useDialogFocus(isOpen, panelRef, { initialFocus: () => panelRef.value })
const isMac = detectMac()

const groupOrder: ShortcutGroup[] = ['playback', 'navigation', 'general']

interface Row {
  id: string
  label: string
  combos: string[][]
  range: boolean
}

function toRow(definition: ShortcutDefinition): Row {
  const options = { isMac, spaceLabel: t('shortcuts.space') }
  return {
    id: definition.id,
    label: t(definition.labelKey ?? definition.id),
    combos: definition.display ?? definition.combos.map(combo => formatCombo(combo, options)),
    range: Boolean(definition.display),
  }
}

// Recomputed on open so shortcuts registered later (and locale changes) show up.
const groups = computed(() => {
  if (!isOpen.value) {
    return []
  }
  const definitions = shortcutRegistry.list().filter(definition => definition.labelKey && definition.group)
  return groupOrder
    .map(group => ({
      group,
      rows: definitions.filter(definition => definition.group === group).map(toRow),
    }))
    .filter(section => section.rows.length > 0)
})

function handleBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) {
    close()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="shortcut-help">
      <div
        v-if="isOpen"
        class="shortcut-help-backdrop"
        @mousedown="handleBackdropClick"
      >
        <div
          ref="panelRef"
          class="shortcut-help-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcut-help-title"
          tabindex="-1"
          @keydown="onKeydown"
        >
          <header class="shortcut-help-header">
            <h2
              id="shortcut-help-title"
              class="shortcut-help-title"
            >
              {{ t('shortcuts.title') }}
            </h2>
            <button
              type="button"
              class="shortcut-help-close"
              :aria-label="t('common.actions.close')"
              @click="close"
            >
              <span
                class="i-jannchie-x"
                aria-hidden="true"
              />
            </button>
          </header>

          <div class="shortcut-help-body inner-scroll">
            <section
              v-for="section in groups"
              :key="section.group"
              class="shortcut-help-section"
            >
              <h3 class="shortcut-help-section-title">
                {{ t(`shortcuts.groups.${section.group}`) }}
              </h3>
              <dl class="shortcut-help-list">
                <div
                  v-for="row in section.rows"
                  :key="row.id"
                  class="shortcut-help-row"
                >
                  <dt class="shortcut-help-label">
                    {{ row.label }}
                  </dt>
                  <dd class="shortcut-help-keys">
                    <template
                      v-for="(combo, index) in row.combos"
                      :key="index"
                    >
                      <span
                        v-if="index > 0"
                        class="shortcut-help-sep"
                        aria-hidden="true"
                      >{{ row.range ? '–' : '/' }}</span>
                      <span class="shortcut-help-combo">
                        <kbd
                          v-for="cap in combo"
                          :key="cap"
                          class="kbd"
                        >{{ cap }}</kbd>
                      </span>
                    </template>
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <footer class="shortcut-help-footer">
            <i18n-t
              keypath="shortcuts.hint"
              tag="span"
            >
              <template #key>
                <kbd class="kbd">?</kbd>
              </template>
            </i18n-t>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.shortcut-help-backdrop {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(8, 10, 16, 0.5);
}

.shortcut-help-panel {
  display: flex;
  flex-direction: column;
  width: min(100%, 40rem);
  max-height: min(40rem, calc(100dvh - 2rem));
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-primary);
  box-shadow: var(--shadow-overlay);
  outline: none;
}

.shortcut-help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1rem 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border);
}

.shortcut-help-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-primary);
}

.shortcut-help-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color var(--duration-fast) ease, background var(--duration-fast) ease;
}

.shortcut-help-close:hover {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.shortcut-help-body {
  display: grid;
  gap: 1.25rem;
  padding: 1rem 1.25rem 1.25rem;
  overflow-y: auto;
}

@media (min-width: 640px) {
  .shortcut-help-body {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: auto 1fr;
    column-gap: 2rem;
    align-items: start;
  }
  .shortcut-help-section:first-child {
    grid-row: span 2;
  }
}

.shortcut-help-section-title {
  margin: 0 0 0.5rem;
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.shortcut-help-list {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.shortcut-help-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 2rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--border);
}

.shortcut-help-row:last-child {
  border-bottom: none;
}

.shortcut-help-label {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.shortcut-help-keys {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.25rem;
  margin: 0;
}

.shortcut-help-combo {
  display: inline-flex;
  gap: 0.1875rem;
}

.shortcut-help-sep {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.shortcut-help-footer {
  padding: 0.75rem 1.25rem;
  border-top: 1px solid var(--border);
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.shortcut-help-enter-active,
.shortcut-help-leave-active {
  transition: opacity var(--duration-base) ease;
}

.shortcut-help-enter-active .shortcut-help-panel,
.shortcut-help-leave-active .shortcut-help-panel {
  transition: transform var(--duration-base) var(--ease-out);
}

.shortcut-help-enter-from,
.shortcut-help-leave-to {
  opacity: 0;
}

.shortcut-help-enter-from .shortcut-help-panel,
.shortcut-help-leave-to .shortcut-help-panel {
  transform: translateY(6px) scale(0.99);
}
</style>
