import type { MusicDlSource, MusicDlUrlSource } from './musicSources.js'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { musicDlSources, musicDlUrlSources } from './musicSources.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRootDir = path.resolve(__dirname, '../..')
export const projectRootEnvPath = path.resolve(projectRootDir, '.env')
export const appDataDir = path.resolve(projectRootDir, 'api/data')
export const appConfigJsonPath = path.resolve(appDataDir, 'app-config.json')
export const secretsJsonPath = path.resolve(appDataDir, 'secrets.json')

export type ConfigSource = Record<string, string | undefined>

export type StorageBackend = 's3' | 'fs'

export const aiProviderApiKeyEnvNames = {
  openai: 'OPENAI_API_KEY',
} as const
export type AiProvider = keyof typeof aiProviderApiKeyEnvNames

export const secretConfigKeys = new Set([
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  aiProviderApiKeyEnvNames.openai,
])

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

export interface AiProviderConfig {
  apiKeyEnvName: string
  apiKey?: string
}

export interface AiConfig {
  providers: Record<AiProvider, AiProviderConfig>
}

export interface AppConfig {
  port: number
  dbPath: string
  storage: {
    backend: StorageBackend
    s3?: S3Config
    fs?: FsStorageConfig
  }
  ai: AiConfig
  musicdl: MusicDlRuntimeConfig
  importCandidateTtlMs: number
  importWorkerPollMs: number
}

function requireEnv(source: ConfigSource, key: string): string {
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
  source: ConfigSource,
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

function loadStorageConfig(source: ConfigSource): AppConfig['storage'] {
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

function loadMusicDlConfig(source: ConfigSource): MusicDlRuntimeConfig {
  return {
    searchTimeoutMs: Number(source.MUSICDL_SEARCH_TIMEOUT_MS ?? '30000'),
    downloadTimeoutMs: Number(source.MUSICDL_DOWNLOAD_TIMEOUT_MS ?? '180000'),
    sources: readCsvEnv(source, 'MUSICDL_SOURCES', musicDlSources, musicDlSources),
    urlSources: readCsvEnv(source, 'MUSICDL_URL_SOURCES', musicDlUrlSources, musicDlUrlSources),
  }
}

function loadAiConfig(source: ConfigSource): AiConfig {
  const openaiApiKey = source[aiProviderApiKeyEnvNames.openai]?.trim()
  return {
    providers: {
      openai: {
        apiKeyEnvName: aiProviderApiKeyEnvNames.openai,
        apiKey: openaiApiKey || undefined,
      },
    },
  }
}

function readJsonStringMap(filePath: string): ConfigSource {
  let raw = ''
  try {
    raw = readFileSync(filePath, 'utf8')
  }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error
    }
    return {}
  }

  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid config file: ${filePath}`)
  }

  const source: ConfigSource = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new TypeError(`Invalid config value for ${key} in ${filePath}`)
    }
    source[key] = value
  }
  return source
}

export function pickSecretConfigSource(source: ConfigSource): ConfigSource {
  const secrets: ConfigSource = {}
  for (const key of secretConfigKeys) {
    const value = source[key]
    if (value?.trim()) {
      secrets[key] = value
    }
  }
  return secrets
}

export function readPersistedConfigSource(): ConfigSource {
  return {
    ...readJsonStringMap(appConfigJsonPath),
    ...readJsonStringMap(secretsJsonPath),
  }
}

export function mergeConfigSources(...sources: ConfigSource[]): ConfigSource {
  const merged: ConfigSource = {}
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (value?.trim()) {
        merged[key] = value
      }
    }
  }
  return merged
}

export function readEffectiveConfigSource(source: ConfigSource = env): ConfigSource {
  return mergeConfigSources(source, readPersistedConfigSource(), pickSecretConfigSource(source))
}

export function loadConfig(source: ConfigSource = readEffectiveConfigSource()): AppConfig {
  const dbPath = resolveProjectPath(source.DB_PATH ?? './api/data/audoria.sqlite')
  mkdirSync(path.dirname(dbPath), { recursive: true })

  return {
    port: Number(source.PORT ?? '8787'),
    dbPath,
    storage: loadStorageConfig(source),
    ai: loadAiConfig(source),
    musicdl: loadMusicDlConfig(source),
    importCandidateTtlMs: Number(source.IMPORT_CANDIDATE_TTL_MS ?? 30 * 60 * 1000),
    importWorkerPollMs: Number(source.IMPORT_WORKER_POLL_MS ?? 3000),
  }
}

loadEnv({ path: projectRootEnvPath })

export const config = loadConfig()
