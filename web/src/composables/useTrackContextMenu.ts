import type { Music } from '../api/types.gen'
import type { ContextMenuItem } from './useContextMenu'
import { useI18n } from 'vue-i18n'
import { useConfirm } from './useConfirm'
import { useInputPrompt } from './useInputPrompt'
import { buildDownloadUrl } from './useMusic'
import { usePlayerState } from './usePlayerState'
import { useAddTrackToPlaylist, useCreatePlaylist, usePlaylistsQuery, useRemoveTrackFromPlaylist } from './usePlaylists'
import { useToast } from './useToast'

export interface TrackContextOptions {
  tracks: Music[]
  playlistContext?: { playlistId: string }
  onEditMetadata?: (track: Music) => void
  onDelete?: (tracks: Music[]) => void | Promise<void>
}

// The download endpoint answers with `Content-Disposition: attachment`, so
// navigating to it saves the original file without leaving the page.
function downloadTrack(track: Music): void {
  const link = document.createElement('a')
  link.href = buildDownloadUrl(track.id)
  link.download = track.filename
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
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
  const { confirm } = useConfirm()
  const toast = useToast()

  function playlistName(playlistId: string): string {
    return playlists.value?.find(playlist => playlist.id === playlistId)?.name ?? ''
  }

  async function addTracksToPlaylist(playlistId: string, tracks: Music[], name = playlistName(playlistId)): Promise<void> {
    for (const track of tracks) {
      try {
        await addTrackMutation.mutateAsync({ playlistId, trackId: track.id })
      }
      catch {
        // Track already in playlist — skip silently.
      }
    }
    toast.show({ message: t('feedback.addedToPlaylist', { name }), icon: 'i-tabler-playlist-add', tone: 'success' })
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
    toast.show({ message: t('feedback.removedFromPlaylist', { name: playlistName(playlistId) }), icon: 'i-tabler-playlist-off' })
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
      await addTracksToPlaylist(playlist.id, tracks, playlist.name)
    }
    catch {
      toast.show({ message: t('feedback.failed'), icon: 'i-tabler-alert-circle', tone: 'danger' })
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
      let containsCount = 0
      for (const track of tracks) {
        if ((track.playlistIds ?? []).includes(playlist.id)) {
          containsCount += 1
        }
      }
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
        onSelect: () => {
          enqueueNext(ids)
          toast.show({ message: t('feedback.playNext'), icon: 'i-tabler-corner-down-right', tone: 'success' })
        },
      },
      {
        id: 'add-to-queue',
        label: t('common.actions.addToQueue'),
        icon: 'i-tabler-playlist-add',
        onSelect: () => {
          enqueueLast(ids)
          toast.show({ message: t('feedback.addedToQueue'), icon: 'i-tabler-playlist-add', tone: 'success' })
        },
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
        onSelect: () => removeTracksFromPlaylist(playlistId, tracks),
      })
    }

    if (singleTrack) {
      items.push(
        { id: 'divider-2', label: '', divider: true },
        {
          id: 'download',
          label: t('common.actions.download'),
          icon: 'i-tabler-download',
          onSelect: () => downloadTrack(singleTrack),
        },
      )
    }

    if (singleTrack && onEditMetadata) {
      items.push({
        id: 'edit-metadata',
        label: t('common.actions.editMetadata'),
        icon: 'i-tabler-edit',
        onSelect: () => onEditMetadata(singleTrack),
      })
    }

    if (onDelete) {
      items.push({
        id: 'delete',
        label: t('common.actions.deleteTrack'),
        icon: 'i-tabler-trash',
        danger: true,
        onSelect: async () => {
          const confirmed = await confirm({
            title: singleTrack
              ? t('confirm.deleteTrackTitle', { title: singleTrack.title || singleTrack.filename })
              : t('confirm.deleteTracksTitle', { n: tracks.length }),
            message: t('confirm.deleteTrackMessage'),
            confirmLabel: t('confirm.delete'),
            danger: true,
          })
          if (!confirmed) {
            return
          }
          try {
            await onDelete(tracks)
            toast.show({ message: t('feedback.tracksDeleted'), icon: 'i-tabler-trash' })
          }
          catch {
            toast.show({ message: t('feedback.failed'), icon: 'i-tabler-alert-circle', tone: 'danger' })
          }
        },
      })
    }

    return items
  }

  return {
    buildItems,
  }
}
