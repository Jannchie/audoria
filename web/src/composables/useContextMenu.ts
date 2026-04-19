import { ref } from 'vue'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: string
  disabled?: boolean
  danger?: boolean
  divider?: boolean
  loading?: boolean
  shortcut?: string
  submenu?: ContextMenuItem[] | (() => Promise<ContextMenuItem[]> | ContextMenuItem[])
  onSelect?: () => void | Promise<void>
}

export interface ContextMenuTrigger {
  x: number
  y: number
  items: ContextMenuItem[]
  // Preferred placement: 'auto' (default, near trigger), 'right' of trigger rect, etc.
  placement?: 'auto' | 'right' | 'top'
  anchorRect?: DOMRect | null
}

const visible = ref(false)
const trigger = ref<ContextMenuTrigger | null>(null)

export function useContextMenu() {
  const open = (input: ContextMenuTrigger): void => {
    trigger.value = input
    visible.value = true
  }

  const openFromEvent = (event: MouseEvent, items: ContextMenuItem[]): void => {
    event.preventDefault()
    event.stopPropagation()
    open({
      x: event.clientX,
      y: event.clientY,
      items,
      placement: 'auto',
    })
  }

  const openFromAnchor = (element: HTMLElement, items: ContextMenuItem[]): void => {
    const rect = element.getBoundingClientRect()
    open({
      x: rect.left,
      y: rect.bottom + 4,
      items,
      placement: 'auto',
      anchorRect: rect,
    })
  }

  const close = (): void => {
    visible.value = false
    trigger.value = null
  }

  return {
    close,
    open,
    openFromAnchor,
    openFromEvent,
    trigger,
    visible,
  }
}
