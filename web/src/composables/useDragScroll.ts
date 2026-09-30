import type { Ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { onUnmounted, ref } from 'vue'

// Movement below this many pixels still counts as a click, not a drag.
const DRAG_THRESHOLD_PX = 4
// Velocity is kept per 16ms frame, so friction is frame-rate independent.
const FRICTION_PER_FRAME = 0.95
const MIN_VELOCITY_PX_PER_MS = 0.02
// A pause this long before release means the user stopped, so no glide.
const RELEASE_IDLE_MS = 80

/**
 * Lets a mouse grab and drag a vertical scroll container, with a short
 * momentum glide on release. Touch and pen keep their native scrolling.
 *
 * A drag swallows the click that follows it, so items inside the container
 * (e.g. seekable lyric lines) are not activated by the end of a drag.
 */
export function useDragScroll(target: Ref<HTMLElement | null>) {
  // True while dragging or gliding, so callers can hold off auto-scrolling.
  const isDragScrolling = ref(false)
  const isDragging = ref(false)

  let pointerId: number | null = null
  let startY = 0
  let startScrollTop = 0
  let lastY = 0
  let lastTime = 0
  let velocity = 0
  let momentumFrame = 0
  let suppressClick = false

  function stopMomentum(): void {
    if (momentumFrame) {
      cancelAnimationFrame(momentumFrame)
      momentumFrame = 0
    }
    if (!isDragging.value) {
      isDragScrolling.value = false
    }
  }

  function startMomentum(el: HTMLElement): void {
    let previous = performance.now()
    const step = (now: number): void => {
      const dt = now - previous
      previous = now
      const before = el.scrollTop
      el.scrollTop += velocity * dt
      velocity *= FRICTION_PER_FRAME ** (dt / 16)
      if (Math.abs(velocity) < MIN_VELOCITY_PX_PER_MS || el.scrollTop === before) {
        momentumFrame = 0
        isDragScrolling.value = false
        return
      }
      momentumFrame = requestAnimationFrame(step)
    }
    momentumFrame = requestAnimationFrame(step)
  }

  function handlePointerDown(event: PointerEvent): void {
    const el = target.value
    if (!el || event.pointerType !== 'mouse' || event.button !== 0) {
      return
    }
    if ((event.target as Element | null)?.closest('input, textarea, select')) {
      return
    }
    stopMomentum()
    pointerId = event.pointerId
    startY = event.clientY
    lastY = event.clientY
    lastTime = event.timeStamp
    startScrollTop = el.scrollTop
    velocity = 0
  }

  function handlePointerMove(event: PointerEvent): void {
    const el = target.value
    if (!el || event.pointerId !== pointerId) {
      return
    }
    if (!isDragging.value) {
      if (Math.abs(event.clientY - startY) < DRAG_THRESHOLD_PX) {
        return
      }
      isDragging.value = true
      isDragScrolling.value = true
      globalThis.getSelection()?.removeAllRanges()
    }
    const dt = event.timeStamp - lastTime
    if (dt > 0) {
      velocity = (lastY - event.clientY) / dt
    }
    lastY = event.clientY
    lastTime = event.timeStamp
    el.scrollTop = startScrollTop - (event.clientY - startY)
  }

  function handlePointerUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return
    }
    pointerId = null
    const el = target.value
    if (!isDragging.value || !el) {
      return
    }
    isDragging.value = false
    // The click for this press is dispatched right after pointerup.
    suppressClick = true
    globalThis.setTimeout(() => {
      suppressClick = false
    }, 0)
    if (event.timeStamp - lastTime > RELEASE_IDLE_MS) {
      velocity = 0
    }
    if (Math.abs(velocity) < MIN_VELOCITY_PX_PER_MS) {
      isDragScrolling.value = false
      return
    }
    startMomentum(el)
  }

  function handleClickCapture(event: MouseEvent): void {
    if (!suppressClick) {
      return
    }
    suppressClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  useEventListener(target, 'pointerdown', handlePointerDown)
  useEventListener(target, 'click', handleClickCapture, { capture: true })
  useEventListener(target, 'wheel', stopMomentum, { passive: true })
  useEventListener(globalThis, 'pointermove', handlePointerMove)
  useEventListener(globalThis, 'pointerup', handlePointerUp)
  useEventListener(globalThis, 'pointercancel', handlePointerUp)

  onUnmounted(() => {
    cancelAnimationFrame(momentumFrame)
  })

  return { isDragging, isDragScrolling }
}
