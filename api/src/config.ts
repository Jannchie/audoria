import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { env } from 'node:process'
import { config as loadEnv } from 'dotenv'

export interface S3Config {
  bucket: string
  endpoint?: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

export interface MusicDlConfig {
  searchTimeoutMs?: number
  downloadTimeoutMs?: number
}

export interface AppConfig {
  port: number
  dbPath: string
  s3: S3Config
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

function loadConfig(): AppConfig {
  const dbPath = path.resolve(env.DB_PATH ?? './data/audoria.sqlite')
  mkdirSync(path.dirname(dbPath), { recursive: true })

  return {
    port: Number(env.PORT ?? '8787'),
    dbPath,
    s3: {
      bucket: requireEnv('S3_BUCKET'),
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION ?? 'us-east-1',
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    },
    musicdl: {},
    importCandidateTtlMs: Number(env.IMPORT_CANDIDATE_TTL_MS ?? 30 * 60 * 1000),
    importWorkerPollMs: Number(env.IMPORT_WORKER_POLL_MS ?? 3000),
  }
}

loadEnv()

export const config = loadConfig()
