import type { LyricsDoc } from '@audoria/lyrics-core'
import type { Ref } from 'vue'
import type { Music, MusicDlSearchResult, MusicDlSource, MusicImportJob } from '../api/types.gen'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, ref } from 'vue'
import { client } from '../api/client.gen'
import { deleteMusicById, getMusicByIdVocals, getMusicImportsById, postMusicImports, postMusicImportsSearch, putMusicByIdLyrics, putMusicByIdVocals } from '../api/sdk.gen'
import { translate } from '../i18n'
import { lyricsDocQueryKey } from './useLyrics'

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
  try {
    return new URL(path, `${baseUrl}/`).toString()
  }
  catch {
    // baseUrl is relative (e.g. '/api/v1'); concatenate directly
    const separator = baseUrl.endsWith('/') || path.startsWith('/') ? '' : '/'
    return `${baseUrl}${separator}${path}`
  }
}

export function useMusicQuery(sortKey?: Ref<string | undefined>) {
  const order = computed(() => sortKey?.value)
  return useQuery({
    queryKey: computed(() => [...musicQueryKey, order.value]),
    queryFn: async (): Promise<Music[]> => {
      const baseUrl = client.getConfig().baseUrl ?? ''
      const url = order.value === 'manual'
        ? `${baseUrl}/music?order=manual`
        : `${baseUrl}/music`
      const response = await fetch(url)
      if (!response.ok) {
        await parseJsonError(response, 'errors.loadFailed')
      }
      return await response.json() as Music[]
    },
    staleTime: 10_000,
  })
}

export interface UploadProgress {
  phase: 'uploading' | 'processing'
  percent: number
}

interface UploadSession {
  id: string
  chunkSize: number
  chunkCount: number
}

const UPLOAD_CHUNK_ATTEMPTS = 3

async function putUploadChunk(url: string, chunk: Blob): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    let response: Response | null = null
    try {
      response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunk,
      })
    }
    catch (error) {
      if (attempt >= UPLOAD_CHUNK_ATTEMPTS) {
        throw error
      }
    }
    if (response?.ok) {
      return
    }
    // Client errors will not change on retry; server and network errors may.
    if (response && (response.status < 500 || attempt >= UPLOAD_CHUNK_ATTEMPTS)) {
      await parseJsonError(response, 'errors.uploadFailedStatus')
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 1000))
  }
}

// Uploads go through Cloudflare, which rejects request bodies over 100 MB, so
// files are sent in chunks and assembled by the API.
async function uploadInChunks(file: File, onProgress: (progress: UploadProgress) => void): Promise<Music> {
  const baseUrl = client.getConfig().baseUrl ?? ''
  const sessionResponse = await fetch(`${baseUrl}/music/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name || 'audio', contentType: file.type || null, size: file.size }),
  })
  if (!sessionResponse.ok) {
    await parseJsonError(sessionResponse, 'errors.uploadFailedStatus')
  }
  const session = await sessionResponse.json() as UploadSession
  const sessionUrl = `${baseUrl}/music/uploads/${encodeURIComponent(session.id)}`

  try {
    onProgress({ phase: 'uploading', percent: 0 })
    for (let index = 0; index < session.chunkCount; index += 1) {
      const start = index * session.chunkSize
      const end = Math.min(start + session.chunkSize, file.size)
      await putUploadChunk(`${sessionUrl}/chunks/${index}`, file.slice(start, end))
      onProgress({ phase: 'uploading', percent: Math.round(end / file.size * 100) })
    }

    onProgress({ phase: 'processing', percent: 100 })
    const completeResponse = await fetch(`${sessionUrl}/complete`, { method: 'POST' })
    if (!completeResponse.ok) {
      await parseJsonError(completeResponse, 'errors.uploadFailedStatus')
    }
    return await completeResponse.json() as Music
  }
  catch (error) {
    fetch(sessionUrl, { method: 'DELETE' }).catch(() => {})
    throw error
  }
}

export function useUploadMusic() {
  const queryClient = useQueryClient()
  const progress = ref<UploadProgress | null>(null)

  const mutation = useMutation({
    mutationFn: async (file: File): Promise<Music> => {
      return await uploadInChunks(file, (next) => {
        progress.value = next
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: musicQueryKey }).catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['playlists'] }).catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['playlist'] }).catch(() => {})
    },
    onSettled: () => {
      progress.value = null
    },
  })

  return { ...mutation, progress }
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

/** Puts a track the API returned after an edit into every cached track list. */
function applyUpdatedTrack(queryClient: ReturnType<typeof useQueryClient>, updated: Music): void {
  queryClient.setQueriesData<Music[]>({ queryKey: musicQueryKey, exact: false }, current =>
    current?.map(track => track.id === updated.id ? updated : track) ?? current)
  queryClient.invalidateQueries({ queryKey: musicQueryKey }).catch(() => {})
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
    onSuccess: updated => applyUpdatedTrack(queryClient, updated),
  })
}

export function useUpdateLyrics() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, doc }: { id: string, doc: LyricsDoc | null }): Promise<Music> => {
      const { data, error, response } = await putMusicByIdLyrics({ path: { id }, body: { doc } })
      if (!data) {
        throw new Error(error?.message ?? translate('errors.updateFailedStatus', { status: response.status }))
      }
      return data
    },
    onSuccess: (updated, { doc }) => {
      // The saved document is what the API would return, so the player needn't refetch it.
      queryClient.setQueryData(lyricsDocQueryKey(updated.id, updated.lyrics), doc)
      applyUpdatedTrack(queryClient, updated)
    },
  })
}

/** Downloads a track's stored vocal analysis; null when none has been uploaded yet. */
export async function fetchVocals(id: string): Promise<ArrayBuffer | null> {
  const { data, error, response } = await getMusicByIdVocals({ path: { id }, parseAs: 'arrayBuffer' })
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new Error(error?.message ?? translate('errors.vocalsLoadFailedStatus', { status: response.status }))
  }
  // parseAs makes the body an ArrayBuffer; the generated type only knows it is binary.
  return data as unknown as ArrayBuffer
}

/** Stores a track's vocal analysis (at most 8 MB), replacing any previous one. */
export async function uploadVocals(id: string, analysis: ArrayBuffer | Blob): Promise<Music> {
  const body = analysis instanceof Blob ? analysis : new Blob([analysis], { type: 'application/octet-stream' })
  const { data, error, response } = await putMusicByIdVocals({ path: { id }, body })
  if (!data) {
    throw new Error(error?.message ?? translate('errors.updateFailedStatus', { status: response.status }))
  }
  return data
}

export function useUploadVocals() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, analysis }: { id: string, analysis: ArrayBuffer | Blob }): Promise<Music> => {
      return await uploadVocals(id, analysis)
    },
    onSuccess: updated => applyUpdatedTrack(queryClient, updated),
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

export function useReorderMusic() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (orderedIds: string[]): Promise<Music[]> => {
      const baseUrl = client.getConfig().baseUrl ?? ''
      const response = await fetch(`${baseUrl}/music/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      })
      if (!response.ok) {
        await parseJsonError(response, 'errors.updateFailedStatus')
      }
      return await response.json() as Music[]
    },
    onSuccess: (tracks) => {
      queryClient.setQueriesData<Music[]>({ queryKey: musicQueryKey, exact: false }, tracks)
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
