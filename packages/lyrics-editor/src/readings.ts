import type { LyricsRuby } from '@audoria/lyrics-core'

const SPACE_RE = /\s/u

/**
 * Where an analyzer's readings sit in a cue's text. Its runs ({ text, ruby }) laid end to end
 * must spell the text, give or take whitespace (a draft may have gained or lost a space since
 * the readings were found); otherwise they are for another version of it and nothing is returned.
 */
export function readingRanges(text: string, runs: Array<{ text: string, ruby?: string }> | undefined): LyricsRuby[] {
  if (!runs) {
    return []
  }
  const ranges: LyricsRuby[] = []
  let at = 0
  const skipSpace = (): void => {
    while (at < text.length && SPACE_RE.test(text[at])) {
      at++
    }
  }
  for (const run of runs) {
    let start: number | undefined
    for (const char of run.text) {
      if (SPACE_RE.test(char)) {
        continue
      }
      skipSpace()
      if (!text.startsWith(char, at)) {
        return []
      }
      start ??= at
      at += char.length
    }
    if (run.ruby && start !== undefined) {
      ranges.push({ start, end: at, reading: run.ruby })
    }
  }
  skipSpace()
  return at === text.length ? ranges : []
}
