import type { LyricsDoc } from '@audoria/lyrics-core'
import { z } from '@hono/zod-openapi'

// OpenAPI schema of @audoria/lyrics-core's LyricsDoc, for validating requests and documenting the API.

export const LyricsSyllableSchema = z.object({
  text: z.string().max(100),
  begin: z.number().int().min(0).optional(),
  end: z.number().int().min(0).optional(),
}).openapi('LyricsSyllable', { description: 'One beat of a word sung over several, like a mora of a kanji\'s reading' })

export const LyricsWordSchema = z.object({
  text: z.string().max(1000),
  begin: z.number().int().min(0).optional(),
  end: z.number().int().min(0).optional(),
  syllables: z.array(LyricsSyllableSchema).max(100).optional().openapi({ description: 'The beats the word is sung in, timed one by one; the word spans them' }),
}).openapi('LyricsWord')

export const LyricsRubySchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  reading: z.string().min(1).max(200),
}).openapi('LyricsRuby', { description: 'A hand-set reading over cue text [start, end); unset ranges are read by the analyzer' })

export const LyricsCueSchema = z.object({
  id: z.string().min(1).max(64),
  begin: z.number().int().min(0).optional(),
  end: z.number().int().min(0).optional(),
  agent: z.string().max(64).optional().openapi({ description: 'Singer for duets, as TTML ttm:agent (v1, v2, …)' }),
  words: z.array(LyricsWordSchema).max(500),
  background: z.array(LyricsWordSchema).max(500).optional().openapi({ description: 'Backing vocals sung over this cue' }),
  ruby: z.array(LyricsRubySchema).max(500).optional(),
}).openapi('LyricsCue')

export const LyricsTrackSchema = z.object({
  lang: z.string().min(1).max(35),
  kind: z.enum(['translation', 'transliteration']),
  lines: z.record(z.string(), z.string().max(1000)).openapi({ description: 'Text keyed by cue id' }),
}).openapi('LyricsTrack')

export const LyricsDocSchema = z.object({
  version: z.literal(1),
  timing: z.enum(['none', 'line', 'word']),
  lang: z.string().min(1).max(35).optional(),
  cues: z.array(LyricsCueSchema).max(5000),
  tracks: z.array(LyricsTrackSchema).max(20),
}).openapi('LyricsDoc')

// The schema must describe exactly the core package's types; this fails to compile if they drift.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const schemaMatchesCore: Same<z.infer<typeof LyricsDocSchema>, LyricsDoc> = true
void schemaMatchesCore
