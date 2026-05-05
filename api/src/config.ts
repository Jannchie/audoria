import type { MusicDlSource, MusicDlUrlSource } from './musicSources.js'
import path from 'node:path'
import { env } from 'node:process'
import { musicDlSources, musicDlUrlSources } from './musicSources.js'

let projectRootDir = '.'
let mkdirSync: ((path: string, options?: any) => void) | undefined
let readFileSync: ((path: string, encoding?: any) => string) | undefined
let loadEnv: ((options?: any) => any) | undefined
try {
  const { mkdirSync: fsMkdirSync, readFileSync: fsReadFileSync } = await import('node:fs')
  mkdirSync = fsMkdirSync
  readFileSync = fsReadFileSync
  if (typeof import.meta.url === 'string' && import.meta.url) {
    const { fileURLToPath } = await import('node:url')
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    projectRootDir = path.resolve(__dirname, '../..')
  }
  const { config: dotenvConfig } = await import('dotenv')
  loadEnv = dotenvConfig
}
catch {
  // Node filesystem or dotenv bootstrap failed
}
export const projectRootEnvPath = path.resolve(projectRootDir, '.env')
export const appDataDir = path.resolve(projectRootDir, 'api/data')
export const appConfigJsonPath = path.resolve(appDataDir, 'app-config.json')
export const secretsJsonPath = path.resolve(appDataDir, 'secrets.json')

export type ConfigSource = Record<string, string | undefined>

export type StorageBackend = 's3' | 'fs'

export const aiProviderDefinitions = {
  openai: { apiKeyEnvName: 'OPENAI_API_KEY', defaultModel: 'gpt-5.4-mini' },
  anthropic: { apiKeyEnvName: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-4-20250514' },
  google: { apiKeyEnvName: 'GOOGLE_API_KEY', defaultModel: 'gemini-2.5-flash' },
  groq: { apiKeyEnvName: 'GROQ_API_KEY', defaultModel: 'llama-3.3-70b-versatile' },
  openrouter: { apiKeyEnvName: 'OPENROUTER_API_KEY', defaultModel: 'openai/gpt-4o' },
  together: { apiKeyEnvName: 'TOGETHER_API_KEY', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  deepseek: { apiKeyEnvName: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-v4-flash' },
} as const

export type AiProvider = keyof typeof aiProviderDefinitions

export const aiProviderApiKeyEnvNames = Object.fromEntries(
  Object.entries(aiProviderDefinitions).map(([key, def]) => [key, def.apiKeyEnvName]),
) as Record<AiProvider, string>

export const secretConfigKeys = new Set([
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'D1_API_TOKEN',
  ...Object.values(aiProviderDefinitions).map(def => def.apiKeyEnvName),
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

export interface D1HttpConfig {
  accountId: string
  databaseId: string
  apiToken: string
  apiBaseUrl: string
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
  defaultModel?: string
  baseUrl?: string
}

export interface AiConfig {
  defaultProvider: AiProvider
  providers: Record<string, AiProviderConfig>
}

export interface AppConfig {
  port: number
  dbPath: string
  dbType: 'sqlite' | 'd1'
  d1?: D1HttpConfig
  storage: {
    backend: StorageBackend
    s3?: S3Config
    fs?: FsStorageConfig
  }
  ai: AiConfig
  musicdl: MusicDlRuntimeConfig
  importCandidateTtlMs: number
  importWorkerPollMs: number
  secretKey: string | null
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

function tryMkdirSync(targetPath: string): void {
  try {
    mkdirSync?.(targetPath, { recursive: true })
  }
  catch {
    // Ignore optional directory bootstrap failures
  }
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
    tryMkdirSync(rootDir)
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

function loadD1Config(source: ConfigSource): D1HttpConfig | undefined {
  if (source.DB_TYPE !== 'd1') {
    return undefined
  }

  return {
    accountId: requireEnv(source, 'D1_ACCOUNT_ID'),
    databaseId: requireEnv(source, 'D1_DATABASE_ID'),
    apiToken: requireEnv(source, 'D1_API_TOKEN'),
    apiBaseUrl: source.D1_API_BASE_URL?.trim() || 'https://api.cloudflare.com/client/v4',
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
  const defaultProvider = (source.AI_DEFAULT_PROVIDER?.trim() || 'openai') as AiProvider
  const providers: Record<string, AiProviderConfig> = {}

  for (const [provider, def] of Object.entries(aiProviderDefinitions)) {
    const key = source[def.apiKeyEnvName]?.trim()
    const modelKey = `AI_${provider.toUpperCase()}_DEFAULT_MODEL`
    const model = source[modelKey]?.trim() || def.defaultModel
    providers[provider] = {
      apiKeyEnvName: def.apiKeyEnvName,
      apiKey: key || undefined,
      defaultModel: model,
    }
  }

  return {
    defaultProvider,
    providers,
  }
}

function readJsonStringMap(filePath: string): ConfigSource {
  let raw = ''
  try {
    raw = readFileSync?.(filePath, 'utf8') ?? ''
  }
  catch {
    // readFileSync may be unavailable or file may not exist
    return {}
  }

  if (!raw.trim()) {
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
  return mergeConfigSources(
    source,
    readPersistedConfigSource(),
    pickSecretConfigSource(source),
  )
}

export function loadConfig(source: ConfigSource = readEffectiveConfigSource()): AppConfig {
  const dbType = source.DB_TYPE === 'd1' ? 'd1' : 'sqlite'
  const dbPath = resolveProjectPath(source.DB_PATH ?? './api/data/audoria.sqlite')
  const d1 = loadD1Config(source)
  if (dbType === 'sqlite') {
    tryMkdirSync(path.dirname(dbPath))
  }

  return {
    port: Number(source.PORT ?? '8787'),
    dbPath,
    dbType,
    d1,
    storage: loadStorageConfig(source),
    ai: loadAiConfig(source),
    musicdl: loadMusicDlConfig(source),
    importCandidateTtlMs: Number(source.IMPORT_CANDIDATE_TTL_MS ?? 30 * 60 * 1000),
    importWorkerPollMs: Number(source.IMPORT_WORKER_POLL_MS ?? 3000),
    secretKey: source.SECRET_KEY?.trim() || null,
  }
}

try {
  loadEnv?.({ path: projectRootEnvPath })
}
catch {
  // dotenv bootstrap failed
}

export const config = loadConfig()
