import type { Music } from '../api/types.gen'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { client } from '../api/client.gen'
import { getMusic, postMusic } from '../api/sdk.gen'

export const musicQueryKey = ['music'] as const

export function buildDownloadUrl(id: string): string {
  return client.buildUrl({
    url: '/music/{id}/download',
    path: { id },
    baseUrl: client.getConfig().baseUrl ?? '',
  })
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
