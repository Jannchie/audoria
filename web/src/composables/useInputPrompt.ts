import { ref } from 'vue'

export interface InputPromptOptions {
  title: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  maxLength?: number
}

interface ActivePrompt extends InputPromptOptions {
  id: number
  resolve: (value: string | null) => void
}

const active = ref<ActivePrompt | null>(null)
let nextId = 1

export function useInputPrompt() {
  function prompt(options: InputPromptOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      active.value = {
        ...options,
        id: nextId++,
        resolve,
      }
    })
  }

  function confirm(value: string): void {
    const current = active.value
    if (!current) {
      return
    }
    active.value = null
    current.resolve(value)
  }

  function cancel(): void {
    const current = active.value
    if (!current) {
      return
    }
    active.value = null
    current.resolve(null)
  }

  return {
    active,
    cancel,
    confirm,
    prompt,
  }
}
