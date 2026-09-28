import type { Ref } from 'vue'
import { nextTick, onBeforeUnmount, watch } from 'vue'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface DialogFocusOptions {
  /** Element to focus when the dialog opens. Defaults to the first focusable. */
  initialFocus?: () => HTMLElement | null | undefined
  /** Keep Tab inside the container. Defaults to true. */
  trap?: boolean
}

function focusableIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)]
    .filter(el => el.getClientRects().length > 0)
}

/**
 * Moves focus into a dialog when it opens, keeps Tab cycling inside it and
 * returns focus to the previously focused element when it closes.
 * Bind the returned `onKeydown` to the dialog container.
 */
export function useDialogFocus(
  isOpen: Ref<boolean>,
  container: Ref<HTMLElement | null>,
  options: DialogFocusOptions = {},
) {
  let restoreTarget: HTMLElement | null = null

  watch(isOpen, async (open) => {
    if (open) {
      restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      const el = container.value
      if (!el) {
        return
      }
      const target = options.initialFocus?.() ?? focusableIn(el)[0] ?? el
      target.focus({ preventScroll: true })
      return
    }
    const target = restoreTarget
    restoreTarget = null
    if (target?.isConnected) {
      target.focus({ preventScroll: true })
    }
  }, { flush: 'post' })

  onBeforeUnmount(() => {
    restoreTarget = null
  })

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || options.trap === false) {
      return
    }
    const el = container.value
    if (!el) {
      return
    }
    const items = focusableIn(el)
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0]
    const last = items.at(-1)!
    const active = document.activeElement
    if (event.shiftKey && (active === first || !el.contains(active))) {
      event.preventDefault()
      last.focus()
    }
    else if (!event.shiftKey && (active === last || !el.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  return { onKeydown }
}
