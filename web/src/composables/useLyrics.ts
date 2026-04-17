import { computed } from 'vue'
import { usePlayerState } from './usePlayerState'

export interface LyricLine {
  time: number
  text: string
}

const LRC_LINE_RE = /^\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]\s?(.*)$/

export function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    const match = LRC_LINE_RE.exec(trimmed)
    if (!match) {
      continue
    }
    const minutes = Number.parseInt(match[1], 10)
    const seconds = Number.parseInt(match[2], 10)
    const ms = match[3] ? Number.parseInt(match[3].padEnd(3, '0'), 10) : 0
    const time = minutes * 60 + seconds + ms / 1000
    const text = match[4]
    lines.push({ time, text })
  }
  lines.sort((a, b) => a.time - b.time)
  return lines
}

export function isLrcFormat(raw: string): boolean {
  const lines = raw.split('\n')
  let timestampCount = 0
  for (const line of lines.slice(0, 20)) {
    if (LRC_LINE_RE.test(line.trim())) {
      timestampCount++
    }
  }
  return timestampCount >= 2
}

export function findLyricLineAtTime(lines: LyricLine[] | null | undefined, time: number): LyricLine | null {
  if (!lines || lines.length === 0) {
    return null
  }

  let currentLine: LyricLine | null = null
  for (const line of lines) {
    if (line.time <= time) {
      currentLine = line
      continue
    }
    return currentLine ?? line
  }

  return currentLine
}

export function useLyrics(lyricsRaw: () => string | null | undefined) {
  const { currentTime } = usePlayerState()

  const parsed = computed(() => {
    const raw = lyricsRaw()
    if (!raw?.trim()) {
      return null
    }
    if (!isLrcFormat(raw)) {
      return null
    }
    return parseLrc(raw)
  })

  const isTimeSynced = computed(() => parsed.value !== null && parsed.value.length > 0)

  const plainText = computed(() => {
    const raw = lyricsRaw()
    if (!raw?.trim()) {
      return ''
    }
    if (isTimeSynced.value && parsed.value) {
      return parsed.value.map(l => l.text).filter(Boolean).join('\n')
    }
    return raw.trim()
  })

  const currentLineIndex = computed(() => {
    const lines = parsed.value
    if (!lines || lines.length === 0) {
      return -1
    }
    const t = currentTime.value
    let idx = -1
    for (const [i, line] of lines.entries()) {
      if (line.time <= t) {
        idx = i
      }
      else {
        break
      }
    }
    return idx
  })

  return {
    parsed,
    isTimeSynced,
    plainText,
    currentLineIndex,
  }
}
