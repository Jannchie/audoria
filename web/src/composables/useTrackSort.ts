import type { Music } from '../api/types.gen'

export type TrackSortKey
  = | 'manual'
    | 'addedDesc'
    | 'nameAsc'
    | 'nameDesc'
    | 'artistAsc'
    | 'durationDesc'
    | 'durationAsc'

export function sortTracks(tracks: Music[], key: TrackSortKey): Music[] {
  if (key === 'manual') {
    return tracks
  }
  const copy = [...tracks]
  const nameOf = (track: Music): string => (track.title || track.filename || '').toLowerCase()
  const artistOf = (track: Music): string => (track.artists || '').toLowerCase()
  const durationOf = (track: Music): number => track.durationSeconds ?? 0
  const addedOf = (track: Music): number => {
    const t = new Date(track.createdAt).getTime()
    return Number.isFinite(t) ? t : 0
  }
  switch (key) {
    case 'nameAsc': {
      copy.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }))
      break
    }
    case 'nameDesc': {
      copy.sort((a, b) => nameOf(b).localeCompare(nameOf(a), undefined, { sensitivity: 'base' }))
      break
    }
    case 'artistAsc': {
      copy.sort((a, b) => artistOf(a).localeCompare(artistOf(b), undefined, { sensitivity: 'base' }))
      break
    }
    case 'durationDesc': {
      copy.sort((a, b) => durationOf(b) - durationOf(a))
      break
    }
    case 'durationAsc': {
      copy.sort((a, b) => durationOf(a) - durationOf(b))
      break
    }
    case 'addedDesc': {
      copy.sort((a, b) => addedOf(b) - addedOf(a))
      break
    }
  }
  return copy
}
