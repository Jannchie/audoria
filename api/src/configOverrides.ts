import { readFile, writeFile } from 'node:fs/promises'
import { projectRootEnvPath } from './config.js'

export type EnvOverrides = Record<string, string | null>

const envLinePattern = /^\s*([a-z_]\w*)\s*=/i

function encodeEnvValue(value: string): string {
  if (!value) {
    return ''
  }
  if (/[\s#"'\\]/.test(value)) {
    return JSON.stringify(value)
  }
  return value
}

export function applyEnvOverrides(target: Record<string, string | undefined>, overrides: EnvOverrides): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete target[key]
      continue
    }
    target[key] = value
  }
}

export async function writeProjectEnvOverrides(overrides: EnvOverrides): Promise<void> {
  let raw = ''
  try {
    raw = await readFile(projectRootEnvPath, 'utf8')
  }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error
    }
  }

  const lines = raw ? raw.replaceAll('\r\n', '\n').split('\n') : []
  if (lines.at(-1) === '') {
    lines.pop()
  }

  const keyToIndex = new Map<string, number>()
  for (const [index, line] of lines.entries()) {
    const match = line.match(envLinePattern)
    if (match) {
      keyToIndex.set(match[1], index)
    }
  }

  const removedIndexes = new Set<number>()
  for (const [key, value] of Object.entries(overrides)) {
    const existingIndex = keyToIndex.get(key)
    if (value === null) {
      if (existingIndex !== undefined) {
        removedIndexes.add(existingIndex)
      }
      continue
    }

    const line = `${key}=${encodeEnvValue(value)}`
    if (existingIndex === undefined) {
      lines.push(line)
      continue
    }
    lines[existingIndex] = line
  }

  const next = lines
    .filter((_, index) => !removedIndexes.has(index))
    .join('\n')

  await writeFile(projectRootEnvPath, `${next}\n`)
}
