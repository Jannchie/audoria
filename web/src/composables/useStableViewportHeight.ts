import { onMounted, onUnmounted } from 'vue'

interface StableViewportHeightOptions {
  variableName?: string
}

function measureSmallViewportHeight(): number {
  if (!globalThis.document) {
    return globalThis.innerHeight
  }

  if (!CSS.supports('height', '100svh')) {
    return Math.round(Math.min(
      globalThis.innerHeight,
      globalThis.visualViewport?.height ?? globalThis.innerHeight,
    ))
  }

  const probe = document.createElement('div')
  probe.style.position = 'fixed'
  probe.style.inset = '0 auto auto 0'
  probe.style.width = '0'
  probe.style.height = '100svh'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'

  document.documentElement.append(probe)
  const height = probe.getBoundingClientRect().height
  probe.remove()

  return Math.round(height || globalThis.innerHeight)
}

/**
 * Provides a stable viewport height for full-screen mobile layouts.
 *
 * iOS Safari changes 100dvh when the bottom address bar expands/collapses,
 * which causes vertically centered layouts to jump. For player-like screens
 * we want one stable layout, so we measure 100svh when available and expose
 * it as a CSS variable. We only re-measure when the viewport width changes,
 * which covers orientation changes without reacting to bottom bar height
 * transitions.
 */
export function useStableViewportHeight(options: StableViewportHeightOptions = {}) {
  const variableName = options.variableName ?? '--stable-viewport-height'
  let frame = 0
  let lastViewportWidth = 0

  function update(force = false): void {
    const currentWidth = Math.round(globalThis.visualViewport?.width ?? globalThis.innerWidth)

    if (!force && currentWidth === lastViewportWidth) {
      return
    }

    lastViewportWidth = currentWidth
    document.documentElement.style.setProperty(variableName, `${measureSmallViewportHeight()}px`)
  }

  function scheduleUpdate(force = false): void {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => update(force))
  }

  function handleResize(): void {
    scheduleUpdate(false)
  }

  function handleOrientationChange(): void {
    globalThis.setTimeout(scheduleUpdate, 250, true)
  }

  onMounted(() => {
    update(true)

    globalThis.addEventListener('resize', handleResize)
    globalThis.addEventListener('orientationchange', handleOrientationChange)
    globalThis.visualViewport?.addEventListener('resize', handleResize)
  })

  onUnmounted(() => {
    cancelAnimationFrame(frame)
    document.documentElement.style.removeProperty(variableName)

    globalThis.removeEventListener('resize', handleResize)
    globalThis.removeEventListener('orientationchange', handleOrientationChange)
    globalThis.visualViewport?.removeEventListener('resize', handleResize)
  })
}
