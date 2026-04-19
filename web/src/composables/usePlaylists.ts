import type { MaybeRefOrGetter } from 'vue'
import type { Playlist, PlaylistDetail } from '../api/types.gen'
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

export const playlistsQueryKey = ['playlists'] as const

function playlistDetailQueryKey(id: string) {
  return ['playlist', id] as const
}

function invalidatePlaylistQueries(queryClient: ReturnType<typeof useQueryClient>, id?: string): void {
  queryClient.invalidateQueries({ queryKey: playlistsQueryKey }).catch(() => {})
  if (id) {
    queryClient.invalidateQueries({ queryKey: playlistDetailQueryKey(id) }).catch(() => {})
  }
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
    staleTime: 5_000,
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
    onSuccess: (playlist) => {
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
    onSuccess: () => {
      invalidatePlaylistQueries(queryClient)
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
    onSuccess: (playlist) => {
      invalidatePlaylistQueries(queryClient, playlist.id)
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
    onSuccess: (playlist) => {
      invalidatePlaylistQueries(queryClient, playlist.id)
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
    onSuccess: (playlist) => {
      invalidatePlaylistQueries(queryClient, playlist.id)
    },
  })
}
