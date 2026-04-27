import { thumbHashToDataURL } from 'thumbhash'

const dataUrlCache = new Map<string, string | null>()

export function thumbhashToDataUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const cached = dataUrlCache.get(value)
  if (cached !== undefined) {
    return cached
  }

  try {
    const binary = atob(value)
    const hash = Uint8Array.from(binary, char => char.charCodeAt(0))
    const dataUrl = thumbHashToDataURL(hash)
    dataUrlCache.set(value, dataUrl)
    return dataUrl
  }
  catch {
    dataUrlCache.set(value, null)
    return null
  }
}

export function thumbhashPlaceholderStyle(value: string | null | undefined): Record<string, string> {
  const dataUrl = thumbhashToDataUrl(value)
  if (!dataUrl) {
    return {}
  }
  return {
    backgroundImage: `url("${dataUrl}")`,
    backgroundPosition: 'center',
    backgroundSize: 'cover',
  }
}
