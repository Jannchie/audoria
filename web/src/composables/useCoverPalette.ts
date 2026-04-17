import type { ComputedRef, Ref } from 'vue'
import { ref, watch } from 'vue'
import { extractPalette } from '../utils/colorPalette'

const DEFAULT_PALETTE = ['#1a2a4a', '#2d5a8f', '#6fb8d0']

export function useCoverPalette(url: Ref<string> | ComputedRef<string>): {
  colors: Ref<string[]>
} {
  const colors = ref<string[]>(DEFAULT_PALETTE)

  watch(
    url,
    (next) => {
      if (!next) {
        colors.value = DEFAULT_PALETTE
        return
      }
      const target = next
      extractPalette(target)
        .then((result) => {
          if (url.value === target) {
            colors.value = result
          }
        })
        .catch(() => {
          if (url.value === target) {
            colors.value = DEFAULT_PALETTE
          }
        })
    },
    { immediate: true },
  )

  return { colors }
}
