<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConfirm } from '../composables/useConfirm'
import { useDialogFocus } from '../composables/useDialogFocus'

const { t } = useI18n()
const { active, accept, cancel } = useConfirm()

const panelRef = ref<HTMLElement | null>(null)
const cancelRef = ref<HTMLButtonElement | null>(null)
const confirmRef = ref<HTMLButtonElement | null>(null)
const isOpen = computed(() => active.value !== null)

// Destructive actions start on "Cancel" so a stray Enter can't delete anything.
const { onKeydown } = useDialogFocus(isOpen, panelRef, {
  initialFocus: () => active.value?.danger ? cancelRef.value : confirmRef.value,
})

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
    return
  }
  onKeydown(event)
}

function handleBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) {
    cancel()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-dialog">
      <div
        v-if="active"
        class="confirm-backdrop"
        @mousedown="handleBackdropClick"
      >
        <div
          ref="panelRef"
          class="confirm-panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          :aria-describedby="active.message ? 'confirm-dialog-message' : undefined"
          @keydown="handleKeydown"
        >
          <h2
            id="confirm-dialog-title"
            class="confirm-title"
          >
            {{ active.title }}
          </h2>
          <p
            v-if="active.message"
            id="confirm-dialog-message"
            class="confirm-message"
          >
            {{ active.message }}
          </p>
          <div class="confirm-actions">
            <button
              ref="cancelRef"
              type="button"
              class="confirm-btn"
              @click="cancel"
            >
              {{ active.cancelLabel ?? t('common.actions.cancel') }}
            </button>
            <button
              ref="confirmRef"
              type="button"
              class="confirm-btn"
              :class="active.danger ? 'confirm-btn--danger' : 'confirm-btn--primary'"
              @click="accept"
            >
              {{ active.confirmLabel ?? t('common.actions.save') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 145;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(8, 10, 16, 0.5);
}

.confirm-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(100%, 24rem);
  padding: 1.25rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-primary);
  box-shadow: var(--shadow-overlay);
}

.confirm-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 500;
  line-height: 1.4;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.confirm-message {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: var(--text-secondary);
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.confirm-btn {
  min-height: 2.5rem;
  padding: 0 1.125rem;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 400;
  cursor: pointer;
  transition: background var(--duration-fast) ease, color var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

.confirm-btn:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.confirm-btn--primary {
  border-color: transparent;
  background: var(--accent);
  color: white;
  font-weight: 500;
}

.confirm-btn--primary:hover {
  background: var(--accent-hover);
  color: white;
}

.confirm-btn--danger {
  border-color: transparent;
  background: var(--danger);
  color: white;
  font-weight: 500;
}

.confirm-btn--danger:hover {
  background: color-mix(in srgb, var(--danger) 88%, black);
  color: white;
}

.confirm-dialog-enter-active,
.confirm-dialog-leave-active {
  transition: opacity var(--duration-base) ease;
}

.confirm-dialog-enter-active .confirm-panel,
.confirm-dialog-leave-active .confirm-panel {
  transition: transform var(--duration-base) var(--ease-out);
}

.confirm-dialog-enter-from,
.confirm-dialog-leave-to {
  opacity: 0;
}

.confirm-dialog-enter-from .confirm-panel,
.confirm-dialog-leave-to .confirm-panel {
  transform: translateY(6px) scale(0.99);
}
</style>
