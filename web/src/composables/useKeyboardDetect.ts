import { onUnmounted, ref, watch } from 'vue'

const CLASS_NAME = 'keyboard-open'

/**
 * Detects whether the virtual keyboard is likely open on mobile devices.
 * Uses the VisualViewport API: when the keyboard slides up on iOS, the
 * visual viewport shrinks below 85% of the layout viewport height.
 *
 * Only "resize" events toggle the keyboard-open class to avoid flickering
 * when the visual viewport scrolls while the keyboard is open.
 */
export function useKeyboardDetect() {
  const isKeyboardOpen = ref(false)

  function update() {
    if (!window.visualViewport) {
      return
    }
    isKeyboardOpen.value = window.visualViewport.height < window.innerHeight * 0.85
  }

  update()

  watch(isKeyboardOpen, (open) => {
    document.body.classList.toggle(CLASS_NAME, open)
  }, { immediate: true })

  // Only resize triggers keyboard state change; scroll during
  // keyboard-open keeps the state stable.
  window.visualViewport?.addEventListener('resize', update)

  onUnmounted(() => {
    document.body.classList.remove(CLASS_NAME)
    window.visualViewport?.removeEventListener('resize', update)
  })

  return { isKeyboardOpen }
}
