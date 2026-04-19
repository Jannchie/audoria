import { ref } from 'vue'

const isOpen = ref(false)

export function useQueuePanel() {
  const open = (): void => {
    isOpen.value = true
  }
  const close = (): void => {
    isOpen.value = false
  }
  const toggle = (): void => {
    isOpen.value = !isOpen.value
  }
  return {
    close,
    isOpen,
    open,
    toggle,
  }
}
