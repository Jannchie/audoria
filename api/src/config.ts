import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRootDir = path.resolve(__dirname, '../..')
const projectRootEnvPath = path.resolve(projectRootDir, '.env')

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

export interface MusicDlConfig {
  searchTimeoutMs?: number
  downloadTimeoutMs?: number
}

export interface AppConfig {
  port: number
  dbPath: string
  storage: {
    backend: StorageBackend
    s3?: S3Config
    fs?: FsStorageConfig
  }
  musicdl: MusicDlConfig
  importCandidateTtlMs: number
  importWorkerPollMs: number
}

function requireEnv(key: string): string {
  const value = env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function resolveProjectPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(projectRootDir, value)
}

function loadStorageConfig(): AppConfig['storage'] {
  const backendValue = env.STORAGE_BACKEND ?? 's3'
  if (backendValue !== 's3' && backendValue !== 'fs') {
    throw new Error(`Unsupported STORAGE_BACKEND: ${backendValue}`)
  }

  if (backendValue === 'fs') {
    const rootDir = resolveProjectPath(env.STORAGE_FS_ROOT ?? './api/data/storage')
    mkdirSync(rootDir, { recursive: true })
    return {
      backend: 'fs',
      fs: { rootDir },
    }
  }

  return {
    backend: 's3',
    s3: {
      bucket: requireEnv('S3_BUCKET'),
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION ?? 'us-east-1',
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    },
  }
}

function loadConfig(): AppConfig {
  const dbPath = resolveProjectPath(env.DB_PATH ?? './api/data/audoria.sqlite')
  mkdirSync(path.dirname(dbPath), { recursive: true })

  return {
    port: Number(env.PORT ?? '8787'),
    dbPath,
    storage: loadStorageConfig(),
    musicdl: {},
    importCandidateTtlMs: Number(env.IMPORT_CANDIDATE_TTL_MS ?? 30 * 60 * 1000),
    importWorkerPollMs: Number(env.IMPORT_WORKER_POLL_MS ?? 3000),
  }
}

loadEnv({ path: projectRootEnvPath })

export const config = loadConfig()
