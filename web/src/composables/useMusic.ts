import type { Ref } from 'vue'
import type { Music, MusicDlSearchResult, MusicDlSource, MusicImportJob } from '../api/types.gen'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed } from 'vue'
import { client } from '../api/client.gen'
import { getMusic, getMusicImportsById, postMusic, postMusicImports, postMusicImportsSearch } from '../api/sdk.gen'

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
    },
  })
}

export function useSearchMusicImport() {
  return useMutation({
    mutationFn: async ({ keyword, source }: { keyword: string, source?: MusicDlSource }): Promise<MusicDlSearchResult[]> => {
      const response = await postMusicImportsSearch({
        body: {
          keyword,
          source,
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

export function useImportJobQuery(jobId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['music-import-job', jobId.value]),
    enabled: computed(() => Boolean(jobId.value)),
    queryFn: async (): Promise<MusicImportJob> => {
      const id = jobId.value
      if (!id) {
        throw new Error('Missing import job id')
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
