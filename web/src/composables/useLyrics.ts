import { computed } from 'vue'
import { usePlayerState } from './usePlayerState'

export interface LyricLine {
  time: number
  text: string
  /** Lines sharing this timestamp after the first, e.g. a translation under the original. */
  translations: string[]
}

const LRC_TIMESTAMP_RE = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g
const LRC_LEADING_TIMESTAMPS_RE = /^(?:\[\d{1,3}:\d{2}(?:\.\d{1,3})?\])+/

function formatLrcTimestamp(totalMs: number): string {
  const clampedMs = Math.max(0, Math.round(totalMs))
  const minutes = Math.floor(clampedMs / 60_000)
  const seconds = Math.floor((clampedMs % 60_000) / 1000)
  const milliseconds = clampedMs % 1000
  return `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}]`
}

export function shiftLrcTimestamps(raw: string, offsetMs: number): string {
  if (!Number.isFinite(offsetMs) || offsetMs === 0) {
    return raw
  }
  return raw.replaceAll(LRC_TIMESTAMP_RE, (_timestamp, minutesRaw: string, secondsRaw: string, msRaw?: string) => {
    const minutes = Number.parseInt(minutesRaw, 10)
    const seconds = Number.parseInt(secondsRaw, 10)
    const milliseconds = msRaw ? Number.parseInt(msRaw.padEnd(3, '0'), 10) : 0
    return formatLrcTimestamp(minutes * 60_000 + seconds * 1000 + milliseconds + offsetMs)
  })
}

function parseLrcTimestamp(minutesRaw: string, secondsRaw: string, msRaw?: string): number {
  const minutes = Number.parseInt(minutesRaw, 10)
  const seconds = Number.parseInt(secondsRaw, 10)
  const ms = msRaw ? Number.parseInt(msRaw.padEnd(3, '0'), 10) : 0
  return minutes * 60 + seconds + ms / 1000
}

/**
 * Parses LRC into one entry per timestamp. Lines repeating a timestamp (how multi-language
 * lyrics carry translations) fold into the first line's `translations`, and a line prefixed
 * with several timestamps (`[00:10][00:30]chorus`) is expanded to each of them.
 */
export function parseLrc(raw: string): LyricLine[] {
  const entries: Array<{ time: number, text: string }> = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    const prefix = LRC_LEADING_TIMESTAMPS_RE.exec(trimmed)?.[0]
    if (!prefix) {
      continue
    }
    const text = trimmed.slice(prefix.length).trim()
    for (const match of prefix.matchAll(LRC_TIMESTAMP_RE)) {
      entries.push({ time: parseLrcTimestamp(match[1], match[2], match[3]), text })
    }
  }
  // Stable sort keeps file order within a timestamp, so the original stays ahead of its translations.
  entries.sort((a, b) => a.time - b.time)

  const lines: LyricLine[] = []
  for (const entry of entries) {
    const previous = lines.at(-1)
    if (!previous || Math.abs(previous.time - entry.time) >= 0.001) {
      lines.push({ time: entry.time, text: entry.text, translations: [] })
      continue
    }
    if (!entry.text || entry.text === previous.text || previous.translations.includes(entry.text)) {
      continue
    }
    if (previous.text) {
      previous.translations.push(entry.text)
    }
    else {
      previous.text = entry.text
    }
  }
  return lines
}

export function isLrcFormat(raw: string): boolean {
  const lines = raw.split('\n')
  let timestampCount = 0
  for (const line of lines.slice(0, 20)) {
    if (LRC_LEADING_TIMESTAMPS_RE.test(line.trim())) {
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
  const { currentTime, lastSeekDelta } = usePlayerState()

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
      return parsed.value.flatMap(l => [l.text, ...l.translations]).filter(Boolean).join('\n')
    }
    return raw.trim()
  })

  // Level 2: compensate lyrics highlight for iOS seek imprecision
  const compensatedTime = computed(() => currentTime.value - lastSeekDelta.value)

  const currentLineIndex = computed(() => {
    const lines = parsed.value
    if (!lines || lines.length === 0) {
      return -1
    }
    const t = compensatedTime.value
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
