import type { MusicDlSource } from '../api/types.gen'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { resolveApiUrl } from './useMusic'

export type MusicDlUrlSource = 'Bilibili' | 'Youtube'

export interface AppConfig {
  api: {
    port: number
  }
  metadata: {
    backend: 'sqlite'
    dbPath: string
  }
  storage:
    | {
      backend: 'fs'
      rootDir: string
    }
    | {
      backend: 's3'
      bucket: string
      endpoint: string | null
      region: string
      forcePathStyle: boolean
      accessKeyConfigured: boolean
      secretKeyConfigured: boolean
    }
  ai: {
    defaultProvider: string
    providers: Record<string, {
      apiKeyEnvName: string
      apiKeyConfigured: boolean
      apiKeySource: 'environment' | 'settings' | null
      defaultModel: string | null
      baseUrl: string | null
    }>
  }
  musicdl: {
    sources: MusicDlSource[]
    urlSources: MusicDlUrlSource[]
    searchTimeoutMs: number
    downloadTimeoutMs: number
  }
  imports: {
    candidateTtlMs: number
    workerPollMs: number
  }
}

export interface AppConfigUpdate {
  metadata?: {
    dbPath?: string
  }
  storage?:
    | {
      backend: 'fs'
      rootDir: string
    }
    | {
      backend: 's3'
      bucket: string
      endpoint?: string | null
      region: string
      forcePathStyle: boolean
      accessKeyId?: string
      secretAccessKey?: string
    }
  ai?: {
    defaultProvider?: string
    providers?: Record<string, {
      apiKey?: string
      removeApiKey?: boolean
      defaultModel?: string
      baseUrl?: string | null
    } | undefined>
  }
  musicdl?: {
    sources?: MusicDlSource[]
    urlSources?: MusicDlUrlSource[]
    searchTimeoutMs?: number
    downloadTimeoutMs?: number
  }
  imports?: {
    candidateTtlMs?: number
    workerPollMs?: number
  }
}

export interface AppConfigUpdateResult {
  config: AppConfig
  restartRequired: boolean
}

async function loadAppConfig(): Promise<AppConfig> {
  const response = await fetch(resolveApiUrl('/app/config'))
  if (!response.ok) {
    throw new Error(`Failed to load app config: ${response.status}`)
  }
  return await response.json() as AppConfig
}

async function updateAppConfig(update: AppConfigUpdate): Promise<AppConfigUpdateResult> {
  const response = await fetch(resolveApiUrl('/app/config'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  })
  const payload = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload && typeof (payload as { message: unknown }).message === 'string'
      ? (payload as { message: string }).message
      : `Failed to update app config: ${response.status}`
    throw new Error(message)
  }
  return payload as AppConfigUpdateResult
}

export function formatConfigMilliseconds(value: number): string {
  if (value >= 1000 && value % 1000 === 0) {
    return `${value / 1000}s`
  }
  return `${value}ms`
}

export function useAppConfigQuery() {
  return useQuery({
    queryKey: ['app-config'],
    queryFn: loadAppConfig,
    staleTime: 60_000,
  })
}

export function useUpdateAppConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateAppConfig,
    onSuccess: (result) => {
      queryClient.setQueryData(['app-config'], result.config)
    },
  })
}
