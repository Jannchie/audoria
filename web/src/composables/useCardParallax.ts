import type { ConfigurableWindow, MaybeElementRef } from '@vueuse/core'
import type { ComputedRef } from 'vue'
import { defaultWindow, useDeviceOrientation, useIdle, useMouseInElement } from '@vueuse/core'
import { computed, nextTick, reactive, watchEffect } from 'vue'

export interface UseCardParallaxOptions extends ConfigurableWindow {
  deviceOrientationTiltAdjust?: (i: number) => number
  deviceOrientationRollAdjust?: (i: number) => number
  mouseTiltAdjust?: (i: number) => number
  mouseRollAdjust?: (i: number) => number
}

export interface UseCardParallaxReturn {
  roll: ComputedRef<number>
  tilt: ComputedRef<number>
  source: ComputedRef<'deviceOrientation' | 'mouse'>
}

export function useCardParallax(
  target: MaybeElementRef,
  options: UseCardParallaxOptions = {},
): UseCardParallaxReturn {
  const {
    deviceOrientationTiltAdjust = i => i,
    deviceOrientationRollAdjust = i => i,
    mouseTiltAdjust = i => i,
    mouseRollAdjust = i => i,
    window = defaultWindow,
  } = options

  const orientation = reactive(useDeviceOrientation({ window }))
  const {
    elementX: x,
    elementY: y,
    elementWidth: width,
    elementHeight: height,
  } = useMouseInElement(target, { handleOutside: true, window })
  const idle = useIdle(2000, { window })

  const stop = watchEffect(() => {
    if (width.value !== 0 || height.value !== 0) {
      x.value = width.value / 2
      y.value = height.value / 2
      nextTick(() => stop())
    }
  })

  const source = computed(() => {
    if (
      orientation.isSupported
      && ((orientation.alpha != null && orientation.alpha !== 0)
        || (orientation.gamma != null && orientation.gamma !== 0))
    ) {
      return 'deviceOrientation'
    }
    return 'mouse'
  })

  function clampMouseValue(value: number): number {
    return Math.min(0.5, Math.max(-0.5, value))
  }

  const roll = computed(() => {
    if (source.value === 'deviceOrientation') {
      const value = -orientation.beta! / 90
      return deviceOrientationRollAdjust(value)
    }
    if (idle.idle.value) {
      return 0
    }
    const value = clampMouseValue(-(y.value - height.value / 2) / height.value)
    return mouseRollAdjust(value)
  })

  const tilt = computed(() => {
    if (source.value === 'deviceOrientation') {
      const value = orientation.gamma! / 90
      return deviceOrientationTiltAdjust(value)
    }
    if (idle.idle.value) {
      return 0
    }
    const value = clampMouseValue((x.value - width.value / 2) / width.value)
    return mouseTiltAdjust(value)
  })

  return { roll, tilt, source }
}
