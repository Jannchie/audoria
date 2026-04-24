import type { MusicDlSource, MusicDlUrlSource } from './musicSources.js'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { musicDlSources, musicDlUrlSources } from './musicSources.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRootDir = path.resolve(__dirname, '../..')
export const projectRootEnvPath = path.resolve(projectRootDir, '.env')

type EnvSource = Record<string, string | undefined>

export type StorageBackend = 's3' | 'fs'

export interface S3Config {
  bucket: string
  endpoint?: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

export interface FsStorageConfig {
  rootDir: string
}

export interface MusicDlRuntimeConfig {
  searchTimeoutMs: number
  downloadTimeoutMs: number
  sources: readonly MusicDlSource[]
  urlSources: readonly MusicDlUrlSource[]
}

export interface MusicDlConfig {
  searchTimeoutMs?: number
  downloadTimeoutMs?: number
  sources?: readonly MusicDlSource[]
  urlSources?: readonly MusicDlUrlSource[]
}

export interface AppConfig {
  port: number
  dbPath: string
  storage: {
    backend: StorageBackend
    s3?: S3Config
    fs?: FsStorageConfig
  }
  musicdl: MusicDlRuntimeConfig
  importCandidateTtlMs: number
  importWorkerPollMs: number
}

function requireEnv(source: EnvSource, key: string): string {
  const value = source[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function resolveProjectPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(projectRootDir, value)
}

function readCsvEnv<T extends string>(
  source: EnvSource,
  key: string,
  availableValues: readonly T[],
  fallback: readonly T[],
): T[] {
  const raw = source[key]
  if (!raw) {
    return [...fallback]
  }

  const values = raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  if (values.length === 0) {
    throw new Error(`${key} must include at least one value`)
  }

  const invalidValues = values.filter(value => !availableValues.includes(value as T))
  if (invalidValues.length > 0) {
    throw new Error(`Unsupported ${key}: ${invalidValues.join(', ')}`)
  }

  return [...new Set(values)] as T[]
}

function loadStorageConfig(source: EnvSource): AppConfig['storage'] {
  const backendValue = source.STORAGE_BACKEND ?? 's3'
  if (backendValue !== 's3' && backendValue !== 'fs') {
    throw new Error(`Unsupported STORAGE_BACKEND: ${backendValue}`)
  }

  if (backendValue === 'fs') {
    const rootDir = resolveProjectPath(source.STORAGE_FS_ROOT ?? './api/data/storage')
    mkdirSync(rootDir, { recursive: true })
    return {
      backend: 'fs',
      fs: { rootDir },
    }
  }

  return {
    backend: 's3',
    s3: {
      bucket: requireEnv(source, 'S3_BUCKET'),
      endpoint: source.S3_ENDPOINT,
      region: source.S3_REGION ?? 'us-east-1',
      accessKeyId: requireEnv(source, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv(source, 'S3_SECRET_ACCESS_KEY'),
      forcePathStyle: source.S3_FORCE_PATH_STYLE !== 'false',
    },
  }
}

function loadMusicDlConfig(source: EnvSource): MusicDlRuntimeConfig {
  return {
    searchTimeoutMs: Number(source.MUSICDL_SEARCH_TIMEOUT_MS ?? '30000'),
    downloadTimeoutMs: Number(source.MUSICDL_DOWNLOAD_TIMEOUT_MS ?? '180000'),
    sources: readCsvEnv(source, 'MUSICDL_SOURCES', musicDlSources, musicDlSources),
    urlSources: readCsvEnv(source, 'MUSICDL_URL_SOURCES', musicDlUrlSources, musicDlUrlSources),
  }
}

export function loadConfig(source: EnvSource = env): AppConfig {
  const dbPath = resolveProjectPath(source.DB_PATH ?? './api/data/audoria.sqlite')
  mkdirSync(path.dirname(dbPath), { recursive: true })

  return {
    port: Number(source.PORT ?? '8787'),
    dbPath,
    storage: loadStorageConfig(source),
    musicdl: loadMusicDlConfig(source),
    importCandidateTtlMs: Number(source.IMPORT_CANDIDATE_TTL_MS ?? 30 * 60 * 1000),
    importWorkerPollMs: Number(source.IMPORT_WORKER_POLL_MS ?? 3000),
  }
}

loadEnv({ path: projectRootEnvPath })

export const config = loadConfig()
