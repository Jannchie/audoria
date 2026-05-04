<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AudoriaLogo from '../components/AudoriaLogo.vue'
import { useAuth } from '../composables/useAuth'

const { t } = useI18n()
const { login } = useAuth()

const token = ref('')
const error = ref('')
const loading = ref(false)

async function handleSubmit(): Promise<void> {
  if (!token.value.trim()) {
    return
  }
  error.value = ''
  loading.value = true
  const result = await login(token.value.trim())
  loading.value = false
  if (!result.ok) {
    error.value = result.message
  }
}
</script>

<template>
  <div class="login-page">
    <form
      class="login-card"
      @submit.prevent="handleSubmit"
    >
      <AudoriaLogo :size="48" />
      <h1 class="login-title">
        Audoria
      </h1>
      <p class="login-subtitle">
        {{ t('auth.loginPrompt') }}
      </p>

      <input
        v-model="token"
        class="login-input"
        type="password"
        :placeholder="t('auth.tokenPlaceholder')"
        :aria-label="t('auth.tokenLabel')"
        autocomplete="off"
        autofocus
        :disabled="loading"
      >

      <p
        v-if="error"
        class="login-error"
        role="alert"
      >
        {{ error }}
      </p>

      <button
        type="submit"
        class="login-btn"
        :disabled="!token.trim() || loading"
      >
        <span
          v-if="loading"
          class="i-tabler-loader-2 animate-spin"
          aria-hidden="true"
        />
        <span v-else>
          {{ t('common.actions.login') }}
        </span>
      </button>
    </form>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--bg-base);
  padding: 1.5rem;
}

.login-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  width: 100%;
  max-width: 22rem;
  padding: 2.5rem 2rem;
  border-radius: 1.25rem;
  background: var(--bg-primary);
  border: 1px solid var(--border);
}

.login-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  font-family: var(--font-display);
  letter-spacing: 0.02em;
  margin: 0;
}

.login-subtitle {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  text-align: center;
  margin: 0;
}

.login-input {
  width: 100%;
  height: 2.75rem;
  padding: 0 1rem;
  border-radius: 0.75rem;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease;
  box-sizing: border-box;
}

.login-input:focus {
  border-color: var(--accent);
}

.login-input:disabled {
  opacity: 0.5;
}

.login-error {
  font-size: 0.75rem;
  color: var(--danger);
  text-align: center;
  margin: 0;
}

.login-btn {
  width: 100%;
  height: 2.75rem;
  border: none;
  border-radius: 0.75rem;
  background: var(--accent);
  color: white;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-btn:hover {
  opacity: 0.9;
}

.login-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
