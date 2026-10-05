/** Formats ms as `m:ss.mmm`, the precision word timing is edited at. */
export function formatTimecode(ms: number | undefined): string {
  if (ms === undefined) {
    return '–:––.–––'
  }
  const total = Math.max(0, Math.round(ms))
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000).toString().padStart(2, '0')
  return `${minutes}:${seconds}.${(total % 1000).toString().padStart(3, '0')}`
}

/** Reads `m:ss.mmm`, `ss.mmm` or plain seconds back into ms; undefined if it isn't a time. */
export function parseTimecode(text: string): number | undefined {
  const match = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(text)
  if (!match) {
    return undefined
  }
  return Math.round((Number(match[1] ?? 0) * 60 + Number(match[2])) * 1000)
}
