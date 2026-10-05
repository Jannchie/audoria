// Format checks kept apart from the parsers, so a caller that only needs to tell formats apart
// doesn't pull in the XML parser.

const LRC_LEADING_TIMESTAMPS_RE = /^(?:\[\d{1,3}:\d{2}(?:\.\d{1,3})?\])+/

/** Whether text reads as LRC: at least two of its first 20 lines start with timestamps. */
export function isLrcFormat(raw: string): boolean {
  let timestampCount = 0
  for (const line of raw.split('\n').slice(0, 20)) {
    if (LRC_LEADING_TIMESTAMPS_RE.test(line.trim())) {
      timestampCount++
    }
  }
  return timestampCount >= 2
}

export function looksLikeTtml(text: string): boolean {
  return /^\s*(?:<\?xml[^>]*\?>\s*)?<tt[\s>]/.test(text)
}
