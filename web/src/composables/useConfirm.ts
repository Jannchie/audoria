import { ref } from 'vue'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm button as destructive. */
  danger?: boolean
}

interface ActiveConfirm extends ConfirmOptions {
  id: number
  resolve: (confirmed: boolean) => void
}

const active = ref<ActiveConfirm | null>(null)
let nextId = 1

/** Promise-based confirmation dialog rendered once by <ConfirmDialog />. */
export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<boolean> {
    // A new request supersedes (and cancels) any pending one.
    active.value?.resolve(false)
    return new Promise<boolean>((resolve) => {
      active.value = { ...options, id: nextId++, resolve }
    })
  }

  function settle(confirmed: boolean): void {
    const current = active.value
    if (!current) {
      return
    }
    active.value = null
    current.resolve(confirmed)
  }

  return {
    accept: () => settle(true),
    active,
    cancel: () => settle(false),
    confirm,
  }
}
