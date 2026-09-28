// Identifies an audio file from its leading bytes. Upstream sources routinely
// mislabel files (e.g. a FLAC served as `audio/mpeg; charset=UTF-8` and named
// .mp3), and Safari trusts the declared type, so the stored type must come
// from the bytes rather than from the source's headers or extension.

export interface AudioFormat {
  contentType: string
  ext: string
}

/** Enough bytes to cover every signature checked below. */
export const AUDIO_SNIFF_BYTES = 64

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}

export function sniffAudioFormat(bytes: Uint8Array): AudioFormat | null {
  if (bytes.length < 12) {
    return null
  }
  if (ascii(bytes, 0, 4) === 'fLaC') {
    return { contentType: 'audio/flac', ext: '.flac' }
  }
  if (ascii(bytes, 4, 8) === 'ftyp') {
    return { contentType: 'audio/mp4', ext: '.m4a' }
  }
  if (ascii(bytes, 0, 4) === 'OggS') {
    return ascii(bytes, 28, 36) === 'OpusHead'
      ? { contentType: 'audio/ogg', ext: '.opus' }
      : { contentType: 'audio/ogg', ext: '.ogg' }
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE') {
    return { contentType: 'audio/wav', ext: '.wav' }
  }
  // An ID3v2 tag can front FLAC too, but in practice it precedes MPEG audio.
  if (ascii(bytes, 0, 3) === 'ID3') {
    return { contentType: 'audio/mpeg', ext: '.mp3' }
  }
  if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) {
    // Layer bits 00 mark ADTS AAC; anything else is an MPEG audio layer.
    return (bytes[1] & 0x06) === 0
      ? { contentType: 'audio/aac', ext: '.aac' }
      : { contentType: 'audio/mpeg', ext: '.mp3' }
  }
  return null
}

/** Swaps the filename's extension for the sniffed one, keeping the base name. */
export function withAudioExtension(filename: string, ext: string): string {
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  return `${base}${ext}`
}
