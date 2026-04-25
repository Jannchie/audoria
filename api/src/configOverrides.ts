import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { appConfigJsonPath, secretConfigKeys, secretsJsonPath } from './config.js'

export type ConfigOverrides = Record<string, string | null>

async function readJsonStringMap(filePath: string): Promise<Record<string, string>> {
  let raw = ''
  try {
    raw = await readFile(filePath, 'utf8')
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

  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`Invalid config value for ${key} in ${filePath}`)
    }
    values[key] = value
  }
  return values
}

async function writeJsonStringMap(filePath: string, values: Record<string, string>, mode?: number): Promise<void> {
  const sortedValues = Object.fromEntries(
    Object.entries(values).sort(([left], [right]) => left.localeCompare(right)),
  )
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(sortedValues, null, 2)}\n`, { mode })
  if (mode !== undefined) {
    await chmod(filePath, mode)
  }
}

export function applyConfigOverrides(target: Record<string, string | undefined>, overrides: ConfigOverrides): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete target[key]
      continue
    }
    target[key] = value
  }
}

export async function writePersistedConfigOverrides(overrides: ConfigOverrides): Promise<void> {
  const appConfigOverrides: ConfigOverrides = {}
  const secretOverrides: ConfigOverrides = {}

  for (const [key, value] of Object.entries(overrides)) {
    if (secretConfigKeys.has(key)) {
      secretOverrides[key] = value
    }
    else {
      appConfigOverrides[key] = value
    }
  }

  const appConfig = await readJsonStringMap(appConfigJsonPath)
  const secrets = await readJsonStringMap(secretsJsonPath)
  applyConfigOverrides(appConfig, appConfigOverrides)
  applyConfigOverrides(secrets, secretOverrides)
  await writeJsonStringMap(appConfigJsonPath, appConfig)
  await writeJsonStringMap(secretsJsonPath, secrets, 0o600)
}
