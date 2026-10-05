import type { Element, Node } from '@xmldom/xmldom'
import type { LyricsCue, LyricsDoc, LyricsRuby, LyricsTrack, LyricsWord } from './doc.js'
import { DOMParser } from '@xmldom/xmldom'
import { cueText, detectLang, isWordTimedCue, rubyRuns, sortedRuby, validateLyricsDoc, wordTimeAt } from './doc.js'

// The TTML dialect Apple Music and AMLL (Apple Music-like Lyrics) share: `itunes:timing`,
// `itunes:key` line ids, `ttm:agent` singers, `x-bg` backing vocals, translations either in an
// `iTunesMetadata` sidecar or inline as `x-translation` / `x-roman` spans, and readings as TTML2
// `tts:ruby` spans, which AMLL renders as furigana.

const TT_NS = 'http://www.w3.org/ns/ttml'
const TTM_NS = 'http://www.w3.org/ns/ttml#metadata'
const TTS_NS = 'http://www.w3.org/ns/ttml#styling'
const ITUNES_NS = 'http://music.apple.com/lyric-ttml-internal'
const AMLL_NS = 'http://www.example.com/ns/amll'

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const CDATA_SECTION_NODE = 4

export class TtmlParseError extends Error {}

// ── Reading ──

/** Reads an attribute by local name, whatever prefix (or missing namespace declaration) it came with. */
function attr(element: Element, localName: string): string | null {
  for (const attribute of element.attributes) {
    if (attribute.localName === localName || attribute.name === localName || attribute.name.endsWith(`:${localName}`)) {
      return attribute.value
    }
  }
  return null
}

function localNameOf(node: Node): string {
  return (node as Element).localName ?? node.nodeName.replace(/^.*:/, '')
}

function childElements(element: Element): Element[] {
  return [...element.childNodes].filter(node => node.nodeType === ELEMENT_NODE) as Element[]
}

function descendants(element: Element, localName: string): Element[] {
  const found: Element[] = []
  for (const child of childElements(element)) {
    if (localNameOf(child) === localName) {
      found.push(child)
    }
    found.push(...descendants(child, localName))
  }
  return found
}

/**
 * Whitespace between spans separates words, but a run that breaks the line is only the file's
 * indentation; dropping it keeps pretty-printed Japanese from gaining spaces between syllables.
 */
function normalizeWhitespace(text: string): string {
  if (/^\s*$/.test(text) && text.includes('\n')) {
    return ''
  }
  return text.replaceAll(/\s+/g, ' ')
}

function textOf(element: Element): string {
  return normalizeWhitespace(element.textContent ?? '').trim()
}

/** Parses TTML clock (`HH:MM:SS.fff`, `MM:SS.fff`, `SS.fff`) and offset (`12.3s`, `250ms`) times into ms. */
export function parseTtmlTime(value: string | null): number | undefined {
  if (!value) {
    return undefined
  }
  const trimmed = value.trim()
  const offset = /^(\d+(?:\.\d+)?)([hms]|ms)$/.exec(trimmed)
  if (offset) {
    const scale = { h: 3_600_000, m: 60_000, s: 1000, ms: 1 }[offset[2] as 'h' | 'm' | 's' | 'ms']
    return Math.round(Number(offset[1]) * scale)
  }
  if (!/^(?:\d+:){0,2}\d+(?:\.\d+)?$/.test(trimmed)) {
    return undefined
  }
  const parts = trimmed.split(':').map(Number)
  const seconds = parts.reduce((total, part) => total * 60 + part, 0)
  return Math.round(seconds * 1000)
}

function timesOf(element: Element): { begin?: number, end?: number } {
  return { begin: parseTtmlTime(attr(element, 'begin')), end: parseTtmlTime(attr(element, 'end')) }
}

interface Piece {
  text: string
  begin?: number
  end?: number
  timed: boolean
  reading?: string
}

interface ParsedLine {
  pieces: Piece[]
  background: Piece[]
  inline: Array<{ kind: LyricsTrack['kind'], lang: string, text: string }>
}

function rubyPiece(container: Element): Piece {
  const spans = descendants(container, 'span')
  const base = spans.filter(span => attr(span, 'ruby') === 'base')
  const texts = spans.filter(span => attr(span, 'ruby') === 'text')
  const times = [container, ...texts].map(timesOf)
  const begins = times.flatMap(time => time.begin === undefined ? [] : [time.begin])
  const ends = times.flatMap(time => time.end === undefined ? [] : [time.end])
  return {
    text: base.map(textOf).join(''),
    reading: texts.map(textOf).join(''),
    ...(begins.length > 0 ? { begin: Math.min(...begins) } : {}),
    ...(ends.length > 0 ? { end: Math.max(...ends) } : {}),
    timed: begins.length > 0 && ends.length > 0,
  }
}

function readInline(element: Element, line: ParsedLine, target: Piece[]): void {
  for (const node of element.childNodes) {
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
      const text = normalizeWhitespace(node.nodeValue ?? '')
      if (text) {
        target.push({ text, timed: false })
      }
      continue
    }
    if (node.nodeType !== ELEMENT_NODE || localNameOf(node) !== 'span') {
      continue
    }
    const span = node as Element
    const role = attr(span, 'role')
    if (role === 'x-translation' || role === 'x-roman') {
      // Translations of backing vocals have nowhere to go in the document and are dropped.
      if (target === line.pieces) {
        line.inline.push({ kind: role === 'x-roman' ? 'transliteration' : 'translation', lang: attr(span, 'lang') ?? 'und', text: textOf(span) })
      }
      continue
    }
    if (role === 'x-bg') {
      const before = line.background.length
      readInline(span, line, line.background)
      // A backing vocal without word spans is timed by its own span.
      const { begin, end } = timesOf(span)
      if (line.background.slice(before).every(piece => !piece.timed) && begin !== undefined && end !== undefined) {
        const text = line.background.splice(before).map(piece => piece.text).join('').trim()
        line.background.push({ text, begin, end, timed: true })
      }
      continue
    }
    if (attr(span, 'ruby') === 'container') {
      target.push(rubyPiece(span))
      continue
    }
    const { begin, end } = timesOf(span)
    if (begin !== undefined && end !== undefined && childElements(span).length === 0) {
      target.push({ text: normalizeWhitespace(span.textContent ?? ''), begin, end, timed: true })
    }
    else {
      readInline(span, line, target)
    }
  }
}

/**
 * Folds pieces into words: each timed piece starts a word and untimed text joins the word
 * before it, so `<span>Hel</span><span>lo</span> <span>world</span>` reads as `Hel`, `lo `,
 * `world`. Lines without timed pieces become one word.
 */
function toWords(pieces: Piece[]): { words: LyricsWord[], ruby: LyricsRuby[] } {
  const words: LyricsWord[] = []
  const ruby: LyricsRuby[] = []
  let length = 0
  let pending = ''
  for (const piece of pieces) {
    let text = piece.text
    if (length === 0 && !pending) {
      text = text.trimStart()
      if (!text) {
        continue
      }
    }
    if (piece.reading && text) {
      ruby.push({ start: length + pending.length, end: length + pending.length + text.length, reading: piece.reading })
    }
    const previous = words.at(-1)
    if (piece.timed) {
      words.push({ text: pending + text, begin: piece.begin, end: piece.end })
      pending = ''
    }
    else if (previous) {
      previous.text += text
    }
    else {
      pending += text
      continue
    }
    length += text.length
  }
  if (pending) {
    words.push({ text: pending })
  }
  const last = words.at(-1)
  if (last) {
    last.text = last.text.trimEnd()
    if (!last.text) {
      words.pop()
    }
  }
  const textLength = cueText({ words }).length
  return { words, ruby: ruby.filter(range => range.end <= textLength) }
}

/**
 * Reads Apple Music / AMLL style TTML into a lyrics document. Song parts, agent names and
 * per-syllable timing of readings are not kept. Throws TtmlParseError on malformed input.
 */
export function lyricsDocFromTtml(xml: string): LyricsDoc {
  const errors: string[] = []
  let root: Element | null
  try {
    root = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') {
          errors.push(message)
        }
      },
    }).parseFromString(xml, 'text/xml').documentElement
  }
  catch (error) {
    throw new TtmlParseError(error instanceof Error ? error.message : String(error))
  }
  if (errors.length > 0 || !root || localNameOf(root) !== 'tt') {
    throw new TtmlParseError(errors[0] ?? 'Not a TTML document')
  }
  const body = childElements(root).find(element => localNameOf(element) === 'body')
  const paragraphs = body ? descendants(body, 'p') : []

  const cues: LyricsCue[] = []
  const keyToCueId = new Map<string, string>()
  const tracks = new Map<string, LyricsTrack>()
  const addTrackLine = (kind: LyricsTrack['kind'], lang: string, cueId: string, text: string): void => {
    if (!text) {
      return
    }
    const trackKey = `${kind}\u0000${lang}`
    const track = tracks.get(trackKey) ?? { lang, kind, lines: {} }
    tracks.set(trackKey, track)
    track.lines[cueId] ??= text
  }

  let wordTimed = false
  for (const [index, paragraph] of paragraphs.entries()) {
    const id = `c${index}`
    const key = attr(paragraph, 'key')
    if (key) {
      keyToCueId.set(key, id)
    }
    const line: ParsedLine = { pieces: [], background: [], inline: [] }
    readInline(paragraph, line, line.pieces)
    const { words, ruby } = toWords(line.pieces)
    const background = toWords(line.background).words
    wordTimed ||= line.pieces.some(piece => piece.timed)

    const times = timesOf(paragraph)
    const begin = times.begin ?? words[0]?.begin
    const end = times.end ?? words.at(-1)?.end
    const agent = attr(paragraph, 'agent')
    cues.push({
      id,
      ...(begin === undefined ? {} : { begin }),
      ...(end === undefined ? {} : { end }),
      ...(agent ? { agent } : {}),
      words,
      ...(background.length > 0 ? { background } : {}),
      ...(ruby.length > 0 ? { ruby } : {}),
    })
    for (const item of line.inline) {
      addTrackLine(item.kind, item.lang, id, item.text)
    }
  }

  // Lines without word spans in a word-timed file stay timed as whole lines. Backing vocals of a
  // word-timed line without their own word spans are timed as one word over the line.
  for (const cue of cues) {
    if (isWordTimedCue(cue)) {
      for (const word of cue.background ?? []) {
        word.begin ??= cue.begin
        word.end ??= cue.end
      }
    }
  }

  const head = childElements(root).find(element => localNameOf(element) === 'head')
  if (head) {
    for (const kind of ['translation', 'transliteration'] as const) {
      for (const sidecar of descendants(head, kind)) {
        const lang = attr(sidecar, 'lang') ?? 'und'
        for (const text of descendants(sidecar, 'text')) {
          const cueId = keyToCueId.get(attr(text, 'for') ?? '')
          if (cueId) {
            addTrackLine(kind, lang, cueId, textOf(text))
          }
        }
      }
    }
  }

  const timingAttr = attr(root, 'timing')?.toLowerCase()
  const hasTimes = cues.some(cue => cue.begin !== undefined)
  const timing = wordTimed ? 'word' : (hasTimes && timingAttr !== 'none' ? 'line' : 'none')
  const lang = attr(root, 'lang') ?? detectLang(cues.map(cueText))
  const doc: LyricsDoc = {
    version: 1,
    timing,
    ...(lang ? { lang } : {}),
    cues: timing === 'none' ? cues.map(({ begin: _begin, end: _end, ...cue }) => cue) : cues,
    tracks: [...tracks.values()],
  }
  const problem = validateLyricsDoc(doc)
  if (problem) {
    throw new TtmlParseError(problem)
  }
  return doc
}

// ── Writing ──

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/** Formats ms as TTML clock time, `HH:MM:SS.mmm`. */
function formatTtmlTime(totalMs: number): string {
  const ms = Math.max(0, Math.round(totalMs))
  const hours = Math.floor(ms / 3_600_000).toString().padStart(2, '0')
  const minutes = Math.floor((ms % 3_600_000) / 60_000).toString().padStart(2, '0')
  const seconds = Math.floor((ms % 60_000) / 1000).toString().padStart(2, '0')
  return `${hours}:${minutes}:${seconds}.${(ms % 1000).toString().padStart(3, '0')}`
}

function timeAttrs(begin?: number, end?: number): string {
  return `${begin === undefined ? '' : ` begin="${formatTtmlTime(begin)}"`}${end === undefined ? '' : ` end="${formatTtmlTime(end)}"`}`
}

function rubySpan(base: string, reading: string, begin?: number, end?: number): string {
  return `<span tts:ruby="container"><span tts:ruby="base">${escapeXml(base)}</span><span tts:ruby="textContainer"><span tts:ruby="text"${timeAttrs(begin, end)}>${escapeXml(reading)}</span></span></span>`
}

/** A timed word span, with the word's surrounding spaces written between spans where TTML keeps them. */
function wordSpan(text: string, begin?: number, end?: number): string {
  const leading = /^\s*/.exec(text)![0]
  const trailing = /\s*$/.exec(text.slice(leading.length))![0]
  const core = text.slice(leading.length, text.length - trailing.length)
  return `${escapeXml(leading)}${core ? `<span${timeAttrs(begin, end)}>${escapeXml(core)}</span>` : ''}${escapeXml(trailing)}`
}

function writeLineContent(cue: LyricsCue): string {
  let result = rubyRuns(cue).map(run => run.reading ? rubySpan(run.text, run.reading) : escapeXml(run.text)).join('')
  if (cue.background && cue.background.length > 0) {
    result += `<span ttm:role="x-bg">${escapeXml(cue.background.map(word => word.text).join(''))}</span>`
  }
  return result
}

/**
 * Writes word spans, turning each reading into a ruby span. A reading over several words
 * becomes one span over their combined time; one over part of a word splits the word, sharing
 * its time out by length.
 */
function writeWordContent(cue: LyricsCue): string {
  const ruby = sortedRuby(cue)
  let result = ''
  let offset = 0
  let index = 0
  while (index < cue.words.length) {
    const word = cue.words[index]
    const wordStart = offset
    const wordEnd = offset + word.text.length
    const spanning = ruby.find(range => range.start === wordStart && range.end > wordEnd)
    if (spanning) {
      let last = index
      let end = wordEnd
      while (end < spanning.end) {
        last++
        end += cue.words[last].text.length
      }
      const text = cue.words.slice(index, last + 1).map(item => item.text).join('')
      const trailing = /\s*$/.exec(text)![0]
      result += rubySpan(text.slice(0, text.length - trailing.length), spanning.reading, word.begin, cue.words[last].end) + escapeXml(trailing)
      offset = end
      index = last + 1
      continue
    }

    const inside = ruby.filter(range => range.start >= wordStart && range.end <= wordEnd)
    const timeAt = (position: number): number | undefined => wordTimeAt(word, position - wordStart)
    let cursor = wordStart
    const pushPart = (end: number): void => {
      if (end > cursor) {
        result += wordSpan(word.text.slice(cursor - wordStart, end - wordStart), timeAt(cursor), timeAt(end))
        cursor = end
      }
    }
    for (const range of inside) {
      pushPart(range.start)
      result += rubySpan(word.text.slice(range.start - wordStart, range.end - wordStart), range.reading, timeAt(range.start), timeAt(range.end))
      cursor = range.end
    }
    pushPart(wordEnd)
    offset = wordEnd
    index++
  }

  if (cue.background && cue.background.length > 0) {
    const begin = cue.background[0].begin
    const end = cue.background.at(-1)!.end
    result += `<span ttm:role="x-bg"${timeAttrs(begin, end)}>${cue.background.map(word => wordSpan(word.text, word.begin, word.end)).join('')}</span>`
  }
  return result
}

function lineKey(index: number): string {
  return `L${index + 1}`
}

export interface TtmlMetadata {
  title?: string | null
  artists?: string | null
  album?: string | null
}

/**
 * Writes a lyrics document as Apple Music / AMLL style TTML, with translations and
 * transliterations in the `iTunesMetadata` sidecar. Line-timed cues without an end run until
 * the next cue.
 */
export function lyricsDocToTtml(doc: LyricsDoc, metadata: TtmlMetadata = {}): string {
  const timing = { none: 'None', line: 'Line', word: 'Word' }[doc.timing]

  const agents = [...new Set(doc.cues.flatMap(cue => cue.agent ? [cue.agent] : []))]
  const meta = [
    ...agents.map(agent => `<ttm:agent type="${agent === 'v1000' ? 'group' : 'person'}" xml:id="${escapeXml(agent)}"/>`),
    ...([['musicName', metadata.title], ['artists', metadata.artists], ['album', metadata.album]] as const)
      .filter(([, value]) => value)
      .map(([key, value]) => `<amll:meta key="${key}" value="${escapeXml(value!)}"/>`),
  ]

  const sidecar = (['translation', 'transliteration'] as const).map((kind) => {
    const items = doc.tracks.filter(track => track.kind === kind).map((track) => {
      const lines = doc.cues.flatMap((cue, index) => track.lines[cue.id] ? [`<text for="${lineKey(index)}">${escapeXml(track.lines[cue.id])}</text>`] : [])
      const type = kind === 'translation' ? ' type="subtitle"' : ''
      return `<${kind}${type} xml:lang="${escapeXml(track.lang)}">${lines.join('')}</${kind}>`
    })
    return items.length > 0 ? `<${kind}s>${items.join('')}</${kind}s>` : ''
  }).join('')
  if (sidecar) {
    meta.push(`<iTunesMetadata xmlns="${ITUNES_NS}">${sidecar}</iTunesMetadata>`)
  }

  const paragraphs = doc.cues.map((cue, index) => {
    const timed = doc.timing !== 'none'
    const end = cue.end ?? (doc.timing === 'line' ? doc.cues[index + 1]?.begin : undefined)
    const attrs = `${timed ? timeAttrs(cue.begin, end) : ''} itunes:key="${lineKey(index)}"${cue.agent ? ` ttm:agent="${escapeXml(cue.agent)}"` : ''}`
    const content = doc.timing === 'word' && isWordTimedCue(cue) ? writeWordContent(cue) : writeLineContent(cue)
    return `<p${attrs}>${content}</p>`
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<tt xmlns="${TT_NS}" xmlns:ttm="${TTM_NS}" xmlns:tts="${TTS_NS}" xmlns:itunes="${ITUNES_NS}" xmlns:amll="${AMLL_NS}" itunes:timing="${timing}"${doc.lang ? ` xml:lang="${escapeXml(doc.lang)}"` : ''}>`,
    `<head><metadata>${meta.join('')}</metadata></head>`,
    '<body><div>',
    ...paragraphs,
    '</div></body>',
    '</tt>',
    '',
  ].join('\n')
}
