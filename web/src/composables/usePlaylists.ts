import type { MaybeRefOrGetter } from 'vue'
import type { Music, Playlist, PlaylistDetail } from '../api/types.gen'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, toValue } from 'vue'
import {
  deletePlaylistsById,
  deletePlaylistsByIdTracksByTrackId,
  getPlaylists,
  getPlaylistsById,
  patchPlaylistsById,
  patchPlaylistsByIdTracksReorder,
  postPlaylists,
  postPlaylistsByIdTracks,
} from '../api/sdk.gen'
import { musicQueryKey } from './useMusic'

export const playlistsQueryKey = ['playlists'] as const

function playlistDetailQueryKey(id: string) {
  return ['playlist', id] as const
}

type QueryClientType = ReturnType<typeof useQueryClient>

function invalidatePlaylistQueries(queryClient: QueryClientType, id?: string): void {
  queryClient.invalidateQueries({ queryKey: playlistsQueryKey }).catch(() => {})
  if (id) {
    queryClient.invalidateQueries({ queryKey: playlistDetailQueryKey(id) }).catch(() => {})
  }
}

function invalidateMusicQuery(queryClient: QueryClientType): void {
  queryClient.invalidateQueries({ queryKey: musicQueryKey }).catch(() => {})
}

function patchMusicCachePlaylistIds(
  queryClient: QueryClientType,
  trackId: string,
  updater: (current: string[]) => string[],
): void {
  queryClient.setQueryData<Music[] | undefined>(musicQueryKey, (current) => {
    if (!current) {
      return current
    }
    let changed = false
    const next = current.map((track) => {
      if (track.id !== trackId) {
        return track
      }
      const before = track.playlistIds ?? []
      const after = updater(before)
      if (after === before) {
        return track
      }
      changed = true
      return { ...track, playlistIds: after }
    })
    return changed ? next : current
  })
}

function patchPlaylistListSummary(
  queryClient: QueryClientType,
  playlistId: string,
  updater: (playlist: Playlist) => Playlist | null,
): void {
  queryClient.setQueryData<Playlist[] | undefined>(playlistsQueryKey, (current) => {
    if (!current) {
      return current
    }
    let changed = false
    const next: Playlist[] = []
    for (const playlist of current) {
      if (playlist.id !== playlistId) {
        next.push(playlist)
        continue
      }
      const updated = updater(playlist)
      if (updated === null) {
        changed = true
        continue
      }
      if (updated !== playlist) {
        changed = true
      }
      next.push(updated)
    }
    return changed ? next : current
  })
}

export function usePlaylistsQuery() {
  return useQuery({
    queryKey: playlistsQueryKey,
    queryFn: async (): Promise<Playlist[]> => {
      const response = await getPlaylists({ throwOnError: true })
      return response.data
    },
    staleTime: 10_000,
  })
}

export function usePlaylistDetailQuery(playlistId: MaybeRefOrGetter<string | null | undefined>) {
  return useQuery({
    queryKey: computed(() => playlistDetailQueryKey(toValue(playlistId) ?? '')),
    enabled: computed(() => Boolean(toValue(playlistId))),
    queryFn: async (): Promise<PlaylistDetail> => {
      const id = toValue(playlistId)
      if (!id) {
        throw new Error('Missing playlist id')
      }
      const response = await getPlaylistsById({
        path: { id },
        throwOnError: true,
      })
      return response.data
    },
    staleTime: 5000,
  })
}

export function useCreatePlaylist() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { name: string, description?: string | null }): Promise<PlaylistDetail> => {
      const response = await postPlaylists({
        body: {
          name: input.name,
          description: input.description ?? undefined,
        },
        throwOnError: true,
      })
      return response.data
    },
    onSuccess: (playlist) => {
      // Optimistically prepend the newly created playlist so the list reflects it immediately.
      queryClient.setQueryData<Playlist[] | undefined>(playlistsQueryKey, (current) => {
        const summary: Playlist = {
          id: playlist.id,
          name: playlist.name,
          description: playlist.description,
          trackCount: playlist.trackCount,
          totalDurationSeconds: playlist.totalDurationSeconds,
          previewCoverUrls: playlist.previewCoverUrls,
          previewCoverThumbhashes: playlist.previewCoverThumbhashes,
          createdAt: playlist.createdAt,
          updatedAt: playlist.updatedAt,
        }
        if (!current) {
          return [summary]
        }
        if (current.some(item => item.id === playlist.id)) {
          return current
        }
        return [summary, ...current]
      })
      queryClient.setQueryData(playlistDetailQueryKey(playlist.id), playlist)
      invalidatePlaylistQueries(queryClient, playlist.id)
    },
  })
}

export function useUpdatePlaylist() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, name, description }: {
      id: string
      name: string
      description?: string | null
    }): Promise<PlaylistDetail> => {
      const response = await patchPlaylistsById({
        path: { id },
        body: {
          name,
          description: description ?? undefined,
        },
        throwOnError: true,
      })
      return response.data
    },
    onMutate: ({ id, name, description }) => {
      // Optimistically update playlist meta in the list and detail caches.
      patchPlaylistListSummary(queryClient, id, playlist => ({
        ...playlist,
        name,
        description: description ?? null,
      }))
      queryClient.setQueryData<PlaylistDetail | undefined>(playlistDetailQueryKey(id), (current) => {
        if (!current) {
          return current
        }
        return { ...current, name, description: description ?? null }
      })
    },
    onSuccess: (playlist) => {
      queryClient.setQueryData(playlistDetailQueryKey(playlist.id), playlist)
      invalidatePlaylistQueries(queryClient, playlist.id)
    },
  })
}

export function useDeletePlaylist() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await deletePlaylistsById({
        path: { id },
        throwOnError: true,
      })
    },
    onMutate: (id) => {
      // Remove the playlist from the list and drop the detail cache.
      patchPlaylistListSummary(queryClient, id, () => null)
      queryClient.removeQueries({ queryKey: playlistDetailQueryKey(id) })
      // Strip this playlist id from every track's playlistIds so chips disappear instantly.
      queryClient.setQueryData<Music[] | undefined>(musicQueryKey, (current) => {
        if (!current) {
          return current
        }
        let changed = false
        const next = current.map((track) => {
          if (!(track.playlistIds ?? []).includes(id)) {
            return track
          }
          changed = true
          return { ...track, playlistIds: (track.playlistIds ?? []).filter(pid => pid !== id) }
        })
        return changed ? next : current
      })
    },
    onSuccess: (_data, id) => {
      invalidatePlaylistQueries(queryClient)
      invalidateMusicQuery(queryClient)
      queryClient.removeQueries({ queryKey: playlistDetailQueryKey(id) })
    },
  })
}

export function useAddTrackToPlaylist() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ playlistId, trackId }: { playlistId: string, trackId: string }): Promise<PlaylistDetail> => {
      const response = await postPlaylistsByIdTracks({
        path: { id: playlistId },
        body: { trackId },
        throwOnError: true,
      })
      return response.data
    },
    onMutate: ({ playlistId, trackId }) => {
      // Add the playlist id to the track's playlistIds so chips appear immediately.
      patchMusicCachePlaylistIds(queryClient, trackId, (current) => {
        if (current.includes(playlistId)) {
          return current
        }
        return [...current, playlistId]
      })
      // Bump the playlist's track count in the summary list so the count updates.
      patchPlaylistListSummary(queryClient, playlistId, playlist => ({
        ...playlist,
        trackCount: playlist.trackCount + 1,
      }))
    },
    onSuccess: (playlist) => {
      // Server response is authoritative — replace detail cache and refresh list.
      queryClient.setQueryData(playlistDetailQueryKey(playlist.id), playlist)
      invalidatePlaylistQueries(queryClient, playlist.id)
      invalidateMusicQuery(queryClient)
    },
  })
}

export function useRemoveTrackFromPlaylist() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ playlistId, trackId }: { playlistId: string, trackId: string }): Promise<PlaylistDetail> => {
      const response = await deletePlaylistsByIdTracksByTrackId({
        path: { id: playlistId, trackId },
        throwOnError: true,
      })
      return response.data
    },
    onMutate: ({ playlistId, trackId }) => {
      patchMusicCachePlaylistIds(queryClient, trackId, current =>
        current.includes(playlistId) ? current.filter(id => id !== playlistId) : current)
      patchPlaylistListSummary(queryClient, playlistId, playlist => ({
        ...playlist,
        trackCount: Math.max(0, playlist.trackCount - 1),
      }))
      // Also patch the playlist detail cache so removal is instant on that page.
      queryClient.setQueryData<PlaylistDetail | undefined>(playlistDetailQueryKey(playlistId), (current) => {
        if (!current) {
          return current
        }
        const nextTracks = current.tracks.filter(track => track.id !== trackId)
        if (nextTracks.length === current.tracks.length) {
          return current
        }
        return {
          ...current,
          tracks: nextTracks,
          trackCount: nextTracks.length,
          totalDurationSeconds: nextTracks.reduce((sum, track) => sum + (track.durationSeconds ?? 0), 0),
        }
      })
    },
    onSuccess: (playlist) => {
      queryClient.setQueryData(playlistDetailQueryKey(playlist.id), playlist)
      invalidatePlaylistQueries(queryClient, playlist.id)
      invalidateMusicQuery(queryClient)
    },
  })
}

export function useReorderPlaylistTracks() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ playlistId, trackIds }: { playlistId: string, trackIds: string[] }): Promise<PlaylistDetail> => {
      const response = await patchPlaylistsByIdTracksReorder({
        path: { id: playlistId },
        body: { trackIds },
        throwOnError: true,
      })
      return response.data
    },
    onMutate: ({ playlistId, trackIds }) => {
      // Reorder the detail cache immediately so the list doesn't "snap back" while waiting.
      queryClient.setQueryData<PlaylistDetail | undefined>(playlistDetailQueryKey(playlistId), (current) => {
        if (!current) {
          return current
        }
        const byId = new Map(current.tracks.map(track => [track.id, track]))
        const ordered = trackIds.map(id => byId.get(id)).filter((track): track is Music => track !== undefined)
        if (ordered.length !== current.tracks.length) {
          return current
        }
        return { ...current, tracks: ordered }
      })
    },
    onSuccess: (playlist) => {
      queryClient.setQueryData(playlistDetailQueryKey(playlist.id), playlist)
      invalidatePlaylistQueries(queryClient, playlist.id)
    },
  })
}
