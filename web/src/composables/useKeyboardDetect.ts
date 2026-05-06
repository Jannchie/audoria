import { onUnmounted, ref, watch } from 'vue'

const CLASS_NAME = 'keyboard-open'
const OFFSET_VAR = '--vv-offset-top'

/**
 * Detects whether the virtual keyboard is likely open on mobile devices.
 * Uses the VisualViewport API to compare visual viewport height against
 * the window inner height. When the keyboard slides up on iOS, the visual
 * viewport shrinks and we can hide fixed bottom elements to avoid them
 * being pushed into view above the keyboard.
 *
 * Also tracks visualViewport.offsetTop as a CSS variable so fixed-bottom
 * elements can compensate when the viewport scrolls while the keyboard
 * is open, preventing the player bar from drifting upward during scroll.
 *
 * Only "resize" events change the keyboard-open class to avoid flickering
 * during scroll. The offset variable updates on both resize and scroll to
 * keep fixed elements pinned to the visual bottom.
 *
 * Toggles a CSS class on <body> so fixed-bottom elements like
 * PlayerBar can adjust their bottom offset when the keyboard is open.
 */
export function useKeyboardDetect() {
  const isKeyboardOpen = ref(false)

  /** Update keyboard detection (called on resize only, not scroll). */
  function updateKeyboardState() {
    if (!window.visualViewport) {
      return
    }
    // When keyboard is open on iOS, visual viewport shrinks significantly.
    // Use a generous threshold to avoid false positives from small resizes.
    isKeyboardOpen.value = window.visualViewport.height < window.innerHeight * 0.85
  }

  /** Update the CSS offset variable so fixed elements stay pinned. */
  function updateOffset() {
    if (!window.visualViewport) {
      return
    }
    const offsetTop = Math.round(window.visualViewport.offsetTop)
    document.documentElement.style.setProperty(OFFSET_VAR, `${offsetTop}px`)
  }

  function update() {
    updateKeyboardState()
    updateOffset()
  }

  update()

  watch(isKeyboardOpen, (open) => {
    document.body.classList.toggle(CLASS_NAME, open)
  }, { immediate: true })

  // Resize: keyboard appears/disappears → update both state and offset.
  window.visualViewport?.addEventListener('resize', update)
  // Scroll: visual viewport may scroll while keyboard is open → update
  // the offset only so the bar stays visually pinned. Do *not* toggle
  // keyboard state during scroll to avoid flickering near the threshold.
  window.visualViewport?.addEventListener('scroll', updateOffset)

  onUnmounted(() => {
    document.body.classList.remove(CLASS_NAME)
    document.documentElement.style.removeProperty(OFFSET_VAR)
    window.visualViewport?.removeEventListener('resize', update)
    window.visualViewport?.removeEventListener('scroll', updateOffset)
  })

  return { isKeyboardOpen }
}
