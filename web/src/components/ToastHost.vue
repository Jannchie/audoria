<script setup lang="ts">
import { useToast } from '../composables/useToast'

const { toasts, dismiss } = useToast()
</script>

<template>
  <Teleport to="body">
    <div
      class="toast-host"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="toast"
          :class="`toast--${toast.tone}`"
          @click="dismiss(toast.id)"
        >
          <span
            v-if="toast.icon"
            class="toast-icon"
            :class="toast.icon"
            aria-hidden="true"
          />
          <span class="toast-message">{{ toast.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 0.75rem);
  left: 1rem;
  right: 1rem;
  z-index: 160;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  pointer-events: none;
}

/* Sit just below the desktop top bar. */
@media (min-width: 768px) {
  .toast-host {
    top: calc(env(safe-area-inset-top, 0px) + 4.25rem);
  }
}

.toast {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 100%;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-overlay);
  color: var(--text-primary);
  font-size: 0.8125rem;
  line-height: 1.3;
  pointer-events: auto;
  cursor: default;
}

.toast-icon {
  flex-shrink: 0;
  font-size: 1rem;
  color: var(--text-secondary);
}

.toast--success .toast-icon {
  color: var(--success);
}

.toast--danger .toast-icon {
  color: var(--danger);
}

.toast-message {
  min-width: 0;
  max-width: 28rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--duration-base) ease, transform var(--duration-base) var(--ease-out);
}

.toast-leave-active {
  position: absolute;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.toast-move {
  transition: transform var(--duration-base) var(--ease-out);
}
</style>
