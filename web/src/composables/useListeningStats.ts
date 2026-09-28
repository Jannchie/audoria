import type { Ref } from 'vue'
import type { ListeningStats } from '../api/types.gen'
import { useQuery } from '@tanstack/vue-query'
import { computed } from 'vue'
import { getStats } from '../api/sdk.gen'

export const statsQueryKey = ['stats'] as const

export function useListeningStatsQuery(days: Ref<number>, limit = 10) {
  return useQuery({
    queryKey: computed(() => [...statsQueryKey, days.value, limit]),
    queryFn: async (): Promise<ListeningStats> => {
      const response = await getStats({
        query: {
          days: days.value,
          limit,
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        },
        throwOnError: true,
      })
      return response.data
    },
    staleTime: 30_000,
  })
}
