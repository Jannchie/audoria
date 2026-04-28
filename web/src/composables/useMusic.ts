import type { Ref } from 'vue'
import type { Music, MusicDlSearchResult, MusicDlSource, MusicImportJob } from '../api/types.gen'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed } from 'vue'
import { client } from '../api/client.gen'
import { deleteMusicById, getMusic, getMusicImportsById, postMusic, postMusicImports, postMusicImportsSearch } from '../api/sdk.gen'
import { translate } from '../i18n'

export const musicQueryKey = ['music'] as const
export function buildDownloadUrl(id: string): string {
  return client.buildUrl({
    url: '/music/{id}/download',
    path: { id },
    baseUrl: client.getConfig().baseUrl ?? '',
  })
}

export function resolveApiUrl(path: string): string {
  const baseUrl = client.getConfig().baseUrl ?? ''
  if (!baseUrl) {
    return path
  }
  return new URL(path, `${baseUrl}/`).toString()
}

export function useMusicQuery() {
  return useQuery({
    queryKey: musicQueryKey,
    queryFn: async (): Promise<Music[]> => {
      const response = await getMusic({ throwOnError: true })
      return response.data
    },
    staleTime: 10_000,
  })
}

export function useUploadMusic() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: File): Promise<Music> => {
      const response = await postMusic({
        body: { file },
        throwOnError: true,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: musicQueryKey }).catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['playlists'] }).catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['playlist'] }).catch(() => {})
    },
  })
}

export function useDeleteMusic() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await deleteMusicById({
        path: { id },
        throwOnError: true,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: musicQueryKey }).catch(() => {})
    },
  })
}

export function useSearchMusicImport() {
  return useMutation({
    mutationFn: async ({
      keyword,
      source,
      limitPerSource,
    }: {
      keyword: string
      source?: MusicDlSource
      limitPerSource?: number
    }): Promise<MusicDlSearchResult[]> => {
      const response = await postMusicImportsSearch({
        body: {
          keyword,
          source,
          limitPerSource,
        },
        throwOnError: true,
      })
      return response.data
    },
  })
}

export function useImportMusic() {
  return useMutation({
    mutationFn: async (resultId: string): Promise<MusicImportJob> => {
      const response = await postMusicImports({
        body: { resultId },
        throwOnError: true,
      })
      return response.data
    },
  })
}

export function useParseMusicUrl() {
  return useMutation({
    mutationFn: async (url: string): Promise<MusicDlSearchResult> => {
      const baseUrl = client.getConfig().baseUrl ?? ''
      const response = await fetch(`${baseUrl}/music/imports/parse-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const payload = await response.json().catch(() => null) as unknown
      if (!response.ok) {
        const message = payload && typeof payload === 'object' && 'message' in payload && typeof (payload as { message: unknown }).message === 'string'
          ? (payload as { message: string }).message
          : translate('errors.parseFailedStatus', { status: response.status })
        throw new Error(message)
      }
      return payload as MusicDlSearchResult
    },
  })
}

export interface UpdateMusicPayload {
  title?: string | null
  artists?: string | null
  album?: string | null
  source?: string | null
  lyrics?: string | null
}

async function parseJsonError(response: Response, fallback: string): Promise<never> {
  const payload = await response.json().catch(() => null) as unknown
  const message = payload && typeof payload === 'object' && 'message' in payload && typeof (payload as { message: unknown }).message === 'string'
    ? (payload as { message: string }).message
    : translate(fallback, { status: response.status })
  throw new Error(message)
}

export function useUpdateMusic() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string, patch: UpdateMusicPayload }): Promise<Music> => {
      const baseUrl = client.getConfig().baseUrl ?? ''
      const response = await fetch(`${baseUrl}/music/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!response.ok) {
        await parseJsonError(response, 'errors.updateFailedStatus')
      }
      return await response.json() as Music
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Music[]>(musicQueryKey, current =>
        current?.map(track => track.id === updated.id ? updated : track) ?? current)
      queryClient.invalidateQueries({ queryKey: musicQueryKey }).catch(() => {})
    },
  })
}

export function useUpdateCover() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, file }: { id: string, file: File }): Promise<Music> => {
      const baseUrl = client.getConfig().baseUrl ?? ''
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch(`${baseUrl}/music/${encodeURIComponent(id)}/cover`, {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        await parseJsonError(response, 'errors.coverUploadFailedStatus')
      }
      return await response.json() as Music
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: musicQueryKey }).catch(() => {})
    },
  })
}

export function useDeleteCover() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<Music> => {
      const baseUrl = client.getConfig().baseUrl ?? ''
      const response = await fetch(`${baseUrl}/music/${encodeURIComponent(id)}/cover`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        await parseJsonError(response, 'errors.coverDeleteFailedStatus')
      }
      return await response.json() as Music
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: musicQueryKey }).catch(() => {})
    },
  })
}

export function useImportJobQuery(jobId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['music-import-job', jobId.value]),
    enabled: computed(() => Boolean(jobId.value)),
    queryFn: async (): Promise<MusicImportJob> => {
      const id = jobId.value
      if (!id) {
        throw new Error(translate('errors.missingImportJobId'))
      }
      const response = await getMusicImportsById({
        path: { id },
        throwOnError: true,
      })
      return response.data
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (!status || status === 'queued' || status === 'running') {
        return 1500
      }
      return false
    },
  })
}
