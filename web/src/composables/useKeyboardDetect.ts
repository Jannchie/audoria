import { onUnmounted, ref, watch } from 'vue'

const CLASS_NAME = 'keyboard-open'

/**
 * Detects whether the virtual keyboard is likely open on mobile devices.
 * Uses the VisualViewport API to compare visual viewport height against
 * the window inner height. When the keyboard slides up on iOS, the visual
 * viewport shrinks and we can hide fixed bottom elements to avoid them
 * being pushed into view above the keyboard.
 *
 * Also toggles a CSS class on <body> so fixed-bottom elements like
 * PlayerBar can adjust their bottom offset when the keyboard is open.
 */
export function useKeyboardDetect() {
  const isKeyboardOpen = ref(false)

  function update() {
    if (!window.visualViewport) {
      return
    }
    // When keyboard is open on iOS, visual viewport shrinks significantly.
    // Use a generous threshold to avoid false positives from small resizes.
    isKeyboardOpen.value = window.visualViewport.height < window.innerHeight * 0.85
  }

  update()

  watch(isKeyboardOpen, (open) => {
    document.body.classList.toggle(CLASS_NAME, open)
  }, { immediate: true })

  window.visualViewport?.addEventListener('resize', update)
  window.visualViewport?.addEventListener('scroll', update)

  onUnmounted(() => {
    document.body.classList.remove(CLASS_NAME)
    window.visualViewport?.removeEventListener('resize', update)
    window.visualViewport?.removeEventListener('scroll', update)
  })

  return { isKeyboardOpen }
}
