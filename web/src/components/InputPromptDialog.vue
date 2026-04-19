<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInputPrompt } from '../composables/useInputPrompt'

const { t } = useI18n()
const { active, cancel, confirm } = useInputPrompt()

const value = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

const isOpen = computed(() => active.value !== null)
const options = computed(() => active.value)

watch(isOpen, async (open) => {
  if (!open) {
    value.value = ''
    return
  }
  value.value = active.value?.defaultValue ?? ''
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
})

function submit(): void {
  const trimmed = value.value.trim()
  if (!trimmed) {
    cancel()
    return
  }
  confirm(trimmed)
}

function handleBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) {
    cancel()
  }
}

function handleKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="input-prompt-fade">
      <div
        v-if="isOpen && options"
        class="input-prompt-backdrop"
        role="dialog"
        aria-modal="true"
        @mousedown="handleBackdropClick"
        @keydown="handleKey"
      >
        <div
          class="input-prompt-panel"
          @mousedown.stop
        >
          <h3 class="input-prompt-title">
            {{ options.title }}
          </h3>
          <input
            ref="inputRef"
            v-model="value"
            class="input-prompt-input"
            type="text"
            :maxlength="options.maxLength ?? 120"
            :placeholder="options.placeholder ?? ''"
            @keydown.enter="submit"
            @keydown.escape="cancel"
          >
          <div class="input-prompt-actions">
            <button
              type="button"
              class="input-prompt-btn"
              @click="cancel"
            >
              {{ options.cancelLabel ?? t('common.actions.cancel') }}
            </button>
            <button
              type="button"
              class="input-prompt-btn input-prompt-btn--primary"
              @click="submit"
            >
              {{ options.confirmLabel ?? t('common.actions.save') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.input-prompt-backdrop {
  position: fixed;
  inset: 0;
  z-index: 140;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(8, 10, 16, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.input-prompt-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: min(100%, 22rem);
  padding: 1.25rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--bg-base);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
}

.input-prompt-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
}

.input-prompt-input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 0.875rem;
  outline: none;
}

.input-prompt-input:focus {
  border-color: var(--accent);
}

.input-prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.375rem;
}

.input-prompt-btn {
  min-height: 2.25rem;
  padding: 0 1rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
}

.input-prompt-btn--primary {
  border-color: transparent;
  background: var(--accent);
  color: white;
  font-weight: 600;
}

.input-prompt-fade-enter-active,
.input-prompt-fade-leave-active {
  transition: opacity 0.15s ease;
}

.input-prompt-fade-enter-from,
.input-prompt-fade-leave-to {
  opacity: 0;
}
</style>
