import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseBuffer } from 'music-metadata'

export function formatDurationText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return [hours, minutes, secs]
    .map(value => value.toString().padStart(2, '0'))
    .join(':')
}

async function probeWithMusicMetadata(buffer: Buffer, contentType: string | null): Promise<number | null> {
  try {
    const metadata = await parseBuffer(
      buffer,
      { mimeType: contentType ?? undefined, size: buffer.byteLength },
      { duration: true },
    )
    const duration = metadata.format.duration
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
      return Math.round(duration)
    }
  }
  catch {
    // fall through
  }
  return null
}

async function probeWithFfprobe(buffer: Buffer): Promise<number | null> {
  let dir: string | null = null
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'audoria-probe-'))
    const filePath = path.join(dir, 'track.bin')
    await writeFile(filePath, buffer)
    const output = await new Promise<string>((resolve, reject) => {
      const proc = spawn('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ])
      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout)
        }
        else {
          reject(new Error(stderr.trim() || `ffprobe exited with code ${code}`))
        }
      })
    })
    const value = Number.parseFloat(output.trim())
    if (Number.isFinite(value) && value > 0) {
      return Math.round(value)
    }
  }
  catch {
    // ffprobe missing or failed; give up
  }
  finally {
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
  return null
}

export async function probeDurationSeconds(
  buffer: Buffer,
  contentType: string | null,
): Promise<number | null> {
  const fromLib = await probeWithMusicMetadata(buffer, contentType)
  if (fromLib !== null) {
    return fromLib
  }
  return await probeWithFfprobe(buffer)
}
