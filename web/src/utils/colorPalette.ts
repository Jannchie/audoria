const SAMPLE_SIZE = 48
const HUE_BUCKETS = 24
const paletteCache = new Map<string, string[]>()

export interface ColorPalette {
  color1: string
  color2: string
  color3: string
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) {
    return [0, 0, l]
  }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case rn: {
      h = ((gn - bn) / d + (gn < bn ? 6 : 0)); break
    }
    case gn: {
      h = ((bn - rn) / d + 2); break
    }
    default: {
      h = ((rn - gn) / d + 4)
    }
  }
  return [h / 6, s, l]
}

function hue2rgb(p: number, q: number, t: number): number {
  let tn = t
  if (tn < 0) {
    tn += 1
  }
  if (tn > 1) {
    tn -= 1
  }
  if (tn < 1 / 6) {
    return p + (q - p) * 6 * tn
  }
  if (tn < 1 / 2) {
    return q
  }
  if (tn < 2 / 3) {
    return p + (q - p) * (2 / 3 - tn) * 6
  }
  return p
}

function channelHex(v: number): string {
  return Math.round(v * 255).toString(16).padStart(2, '0')
}

function hslToHex(h: number, s: number, l: number): string {
  let r: number
  let g: number
  let b: number
  if (s === 0) {
    r = g = b = l
  }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.addEventListener('load', () => resolve(img))
    img.addEventListener('error', () => reject(new Error('cover image load failed')))
    img.src = url
  })
}

export async function extractPalette(url: string): Promise<string[]> {
  const cached = paletteCache.get(url)
  if (cached) {
    return cached
  }

  const img = await loadImage(url)
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('canvas 2d context unavailable')
  }
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

  const buckets: { count: number, h: number, s: number, l: number }[] = Array.from(
    { length: HUE_BUCKETS },
    () => ({ count: 0, h: 0, s: 0, l: 0 }),
  )
  let fallbackR = 0
  let fallbackG = 0
  let fallbackB = 0
  let fallbackN = 0

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]
    if (a < 128) {
      continue
    }
    fallbackR += r
    fallbackG += g
    fallbackB += b
    fallbackN += 1
    const hsl = rgbToHsl(r, g, b)
    const h = hsl[0]
    const s = hsl[1]
    const l = hsl[2]
    if (l < 0.08 || l > 0.92 || s < 0.18) {
      continue
    }
    const idx = Math.min(HUE_BUCKETS - 1, Math.floor(h * HUE_BUCKETS))
    const bucket = buckets[idx]
    bucket.count += 1
    bucket.h += h
    bucket.s += s
    bucket.l += l
  }

  const sorted = buckets
    .filter(b => b.count > 0)
    .map(b => ({
      count: b.count,
      h: b.h / b.count,
      s: b.s / b.count,
      l: b.l / b.count,
    }))
    .sort((a, b) => b.count - a.count)

  const colors: string[] = []
  for (const bucket of sorted) {
    if (colors.length >= 3) {
      break
    }
    const tooClose = colors.some((hex) => {
      const r = Number.parseInt(hex.slice(1, 3), 16)
      const g = Number.parseInt(hex.slice(3, 5), 16)
      const b = Number.parseInt(hex.slice(5, 7), 16)
      const existing = rgbToHsl(r, g, b)
      const delta = Math.abs(existing[0] - bucket.h)
      return Math.min(delta, 1 - delta) < 1 / HUE_BUCKETS
    })
    if (tooClose) {
      continue
    }
    colors.push(hslToHex(bucket.h, Math.min(0.75, bucket.s), Math.max(0.35, Math.min(0.6, bucket.l))))
  }

  if (colors.length < 3 && fallbackN > 0) {
    const avgR = fallbackR / fallbackN
    const avgG = fallbackG / fallbackN
    const avgB = fallbackB / fallbackN
    const avg = rgbToHsl(avgR, avgG, avgB)
    const h = avg[0]
    const s = avg[1]
    const l = avg[2]
    while (colors.length < 3) {
      const shift = colors.length * 0.08
      colors.push(hslToHex(
        (h + shift) % 1,
        Math.max(0.35, Math.min(0.7, s + 0.1)),
        Math.max(0.35, Math.min(0.6, l + (colors.length - 1) * 0.05)),
      ))
    }
  }

  while (colors.length < 3) {
    colors.push('#1d2433')
  }

  paletteCache.set(url, colors)
  return colors
}
