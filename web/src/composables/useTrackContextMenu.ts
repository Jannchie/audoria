import type { Music } from '../api/types.gen'
import type { ContextMenuItem } from './useContextMenu'
import { useI18n } from 'vue-i18n'
import { useInputPrompt } from './useInputPrompt'
import { usePlayerState } from './usePlayerState'
import { useAddTrackToPlaylist, useCreatePlaylist, usePlaylistsQuery, useRemoveTrackFromPlaylist } from './usePlaylists'

export interface TrackContextOptions {
  tracks: Music[]
  playlistContext?: { playlistId: string }
  onEditMetadata?: (track: Music) => void
  onDelete?: (tracks: Music[]) => void | Promise<void>
}

export function useTrackContextMenu() {
  const { t } = useI18n()
  const {
    currentTrackId,
    enqueueLast,
    enqueueNext,
    isPlaying,
    selectTrack,
    setPlaying,
  } = usePlayerState()
  const { data: playlists } = usePlaylistsQuery()
  const addTrackMutation = useAddTrackToPlaylist()
  const createPlaylistMutation = useCreatePlaylist()
  const removeMutation = useRemoveTrackFromPlaylist()
  const { prompt } = useInputPrompt()

  async function addTracksToPlaylist(playlistId: string, tracks: Music[]): Promise<void> {
    for (const track of tracks) {
      try {
        await addTrackMutation.mutateAsync({ playlistId, trackId: track.id })
      }
      catch {
        // Track already in playlist — skip silently.
      }
    }
  }

  async function removeTracksFromPlaylist(playlistId: string, tracks: Music[]): Promise<void> {
    for (const track of tracks) {
      try {
        await removeMutation.mutateAsync({ playlistId, trackId: track.id })
      }
      catch {
        // Ignore — track may no longer be in the playlist.
      }
    }
  }

  async function createPlaylistWithTracks(tracks: Music[]): Promise<void> {
    const name = await prompt({
      title: t('common.actions.newPlaylist'),
      placeholder: t('playlist.newPlaylist'),
      confirmLabel: t('common.actions.save'),
    })
    if (!name) {
      return
    }
    try {
      const playlist = await createPlaylistMutation.mutateAsync({ name })
      await addTracksToPlaylist(playlist.id, tracks)
    }
    catch {
      // Errors are surfaced via mutation state.
    }
  }

  function buildPlaylistSubmenu(tracks: Music[]): ContextMenuItem[] {
    const list = playlists.value ?? []
    const newItem: ContextMenuItem = {
      id: 'playlist:new',
      label: t('common.actions.newPlaylist'),
      icon: 'i-tabler-plus',
      onSelect: () => createPlaylistWithTracks(tracks),
    }
    if (list.length === 0) {
      return [newItem]
    }
    const divider: ContextMenuItem = { id: 'playlist:divider', label: '', divider: true }
    const entries: ContextMenuItem[] = list.map((playlist) => {
      const containsCount = tracks.reduce(
        (count, track) => ((track.playlistIds ?? []).includes(playlist.id) ? count + 1 : count),
        0,
      )
      const state: 'all' | 'some' | 'none' = containsCount === 0
        ? 'none'
        : (containsCount === tracks.length ? 'all' : 'some')
      const icon = state === 'all'
        ? 'i-tabler-check'
        : (state === 'some' ? 'i-tabler-minus' : 'i-tabler-playlist')
      return {
        id: `playlist:${playlist.id}`,
        label: playlist.name,
        icon,
        onSelect: () => {
          if (state === 'all') {
            return removeTracksFromPlaylist(playlist.id, tracks)
          }
          return addTracksToPlaylist(playlist.id, tracks)
        },
      }
    })
    return [newItem, divider, ...entries]
  }

  function buildItems(options: TrackContextOptions): ContextMenuItem[] {
    const { tracks, playlistContext, onEditMetadata, onDelete } = options
    if (tracks.length === 0) {
      return []
    }

    const singleTrack = tracks.length === 1 ? tracks[0] : null
    const ids = tracks.map(track => track.id)
    const isCurrent = singleTrack && currentTrackId.value === singleTrack.id

    const items: ContextMenuItem[] = []

    if (singleTrack) {
      items.push({
        id: 'play',
        label: isCurrent && isPlaying.value ? t('common.actions.pause') : t('common.actions.play'),
        icon: isCurrent && isPlaying.value ? 'i-tabler-player-pause' : 'i-tabler-player-play',
        onSelect: () => {
          if (isCurrent) {
            setPlaying(!isPlaying.value)
            return
          }
          selectTrack(singleTrack.id)
          setPlaying(true)
        },
      })
    }

    items.push(
      {
        id: 'play-next',
        label: t('common.actions.playNext'),
        icon: 'i-tabler-corner-down-right',
        onSelect: () => enqueueNext(ids),
      },
      {
        id: 'add-to-queue',
        label: t('common.actions.addToQueue'),
        icon: 'i-tabler-playlist-add',
        onSelect: () => enqueueLast(ids),
      },
      { id: 'divider-1', label: '', divider: true },
      {
        id: 'add-to-playlist',
        label: t('common.actions.addToPlaylist'),
        icon: 'i-tabler-playlist-add',
        submenu: () => buildPlaylistSubmenu(tracks),
      },
    )

    if (playlistContext) {
      const playlistId = playlistContext.playlistId
      items.push({
        id: 'remove-from-playlist',
        label: t('common.actions.removeFromPlaylist'),
        icon: 'i-tabler-playlist-off',
        danger: true,
        onSelect: async () => {
          for (const track of tracks) {
            try {
              await removeMutation.mutateAsync({ playlistId, trackId: track.id })
            }
            catch {
              // ignore
            }
          }
        },
      })
    }

    if (singleTrack && onEditMetadata) {
      items.push(
        { id: 'divider-2', label: '', divider: true },
        {
          id: 'edit-metadata',
          label: t('common.actions.editMetadata'),
          icon: 'i-tabler-edit',
          onSelect: () => onEditMetadata(singleTrack),
        },
      )
    }

    if (onDelete) {
      items.push({
        id: 'delete',
        label: t('common.actions.deleteTrack'),
        icon: 'i-tabler-trash',
        danger: true,
        onSelect: async () => {
          await onDelete(tracks)
        },
      })
    }

    return items
  }

  return {
    buildItems,
  }
}
