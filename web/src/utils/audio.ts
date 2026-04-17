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

export function formatTrackSpecs(track: Pick<Music, 'filename' | 'contentType' | 'size' | 'durationSeconds'>): string {
  const quality = formatTrackQuality(track)
  if (!quality) {
    return formatBytes(track.size)
  }
  return `${formatBytes(track.size)} · ${quality}`
}
