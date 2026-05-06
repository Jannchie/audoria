import type { Music } from '../api/types.gen'

const losslessExtensions = new Set([
  'aif',
  'aiff',
  'alac',
  'ape',
  'flac',
  'wav',
  'wave',
])

const contentTypeToFormat: Record<string, string> = {
  'audio/mpeg': 'MP3',
  'audio/mp3': 'MP3',
  'audio/mp4': 'M4A',
  'audio/x-m4a': 'M4A',
  'audio/flac': 'FLAC',
  'audio/x-flac': 'FLAC',
  'audio/wav': 'WAV',
  'audio/wave': 'WAV',
  'audio/x-wav': 'WAV',
  'audio/ogg': 'OGG',
  'audio/vorbis': 'OGG',
  'audio/aac': 'AAC',
  'audio/x-aac': 'AAC',
  'audio/webm': 'WebM',
  'audio/x-ms-wma': 'WMA',
  'audio/x-wavpack': 'WV',
  'audio/x-ape': 'APE',
  'audio/x-aiff': 'AIFF',
  'audio/aiff': 'AIFF',
  'audio/opus': 'Opus',
  'audio/x-mpegurl': 'M3U',
  'audio/x-scpls': 'PLS',
}

const extensionToFormat: Record<string, string> = {
  'mp3': 'MP3',
  'm4a': 'M4A',
  'flac': 'FLAC',
  'wav': 'WAV',
  'wave': 'WAV',
  'ogg': 'OGG',
  'oga': 'OGG',
  'aac': 'AAC',
  'wma': 'WMA',
  'webm': 'WebM',
  'opus': 'Opus',
  'wv': 'WV',
  'ape': 'APE',
  'aif': 'AIFF',
  'aiff': 'AIFF',
  'alac': 'ALAC',
  'm3u': 'M3U',
  'pls': 'PLS',
}

function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex === -1) {
    return ''
  }
  return filename.slice(dotIndex + 1).toLowerCase()
}

function isLosslessTrack(track: Pick<Music, 'filename' | 'contentType'>): boolean {
  const contentType = track.contentType?.toLowerCase() ?? ''
  if (
    contentType === 'audio/flac'
    || contentType === 'audio/wav'
    || contentType === 'audio/wave'
    || contentType === 'audio/x-flac'
    || contentType === 'audio/x-wav'
  ) {
    return true
  }

  return losslessExtensions.has(getFileExtension(track.filename))
}

function paddedTimePart(value: number): string {
  return value.toString().padStart(2, '0')
}

export function formatTrackDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return '--:--'
  }
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return `${hours}:${paddedTimePart(minutes)}:${paddedTimePart(secs)}`
  }
  return `${minutes}:${paddedTimePart(secs)}`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function getAverageBitrateKbps(track: Pick<Music, 'size' | 'durationSeconds'>): number | null {
  if (!Number.isFinite(track.size) || track.size <= 0) {
    return null
  }
  if (!track.durationSeconds || track.durationSeconds <= 0) {
    return null
  }

  return Math.max(1, Math.round((track.size * 8) / track.durationSeconds / 1000))
}

export function formatTrackQuality(track: Pick<Music, 'filename' | 'contentType' | 'size' | 'durationSeconds'>): string | null {
  const bitrateKbps = getAverageBitrateKbps(track)
  if (isLosslessTrack(track)) {
    return bitrateKbps ? `Lossless · ${bitrateKbps} kbps` : 'Lossless'
  }
  return bitrateKbps ? `${bitrateKbps} kbps` : null
}

export function getFormatName(track: Pick<Music, 'filename' | 'contentType'>): string {
  const contentType = track.contentType?.toLowerCase() ?? ''
  const fromContentType = contentTypeToFormat[contentType]
  if (fromContentType) {
    return fromContentType
  }
  const ext = getFileExtension(track.filename)
  if (ext) {
    return extensionToFormat[ext] ?? ext.toUpperCase()
  }
  return ''
}

export function formatTrackSpecs(track: Pick<Music, 'filename' | 'contentType' | 'size' | 'durationSeconds'>): string {
  const quality = formatTrackQuality(track)
  const formatName = getFormatName(track)
  const parts: string[] = []
  if (quality) {
    parts.push(formatBytes(track.size), quality)
  }
  else {
    parts.push(formatBytes(track.size))
  }
  if (formatName) {
    parts.push(formatName)
  }
  return parts.join(' · ')
}
