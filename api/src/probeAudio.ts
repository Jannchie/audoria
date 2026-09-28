import type { ILyricsTag } from 'music-metadata'
import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFile, selectCover } from 'music-metadata'

export function formatDurationText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return [hours, minutes, secs]
    .map(value => value.toString().padStart(2, '0'))
    .join(':')
}

export async function probeDurationSecondsFromFile(filePath: string): Promise<number | null> {
  try {
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
    // ffprobe missing or failed; caller must treat this as "duration unknown".
  }
  return null
}

/**
 * Copies a FLAC stream into an MP4 container without re-encoding. Safari seeks
 * FLAC by estimating byte offsets and lands off target while reporting the
 * requested time, which desyncs lyrics; MP4's sample tables make seeks exact.
 * Returns false when ffmpeg is missing or fails, so callers keep the original.
 */
export async function remuxFlacToMp4(inputPath: string, outputPath: string): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-i',
        inputPath,
        '-map',
        '0:a:0',
        '-map_metadata',
        '0',
        '-c:a',
        'copy',
        '-f',
        'mp4',
        '-movflags',
        '+faststart',
        outputPath,
      ])
      let stderr = ''
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code === 0) {
          resolve()
        }
        else {
          reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))
        }
      })
    })
    return true
  }
  catch (error) {
    console.warn(`FLAC to MP4 remux failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

export interface EmbeddedMetadata {
  title: string | null
  artists: string | null
  album: string | null
  lyrics: string | null
  cover: Uint8Array | null
}

const emptyEmbeddedMetadata: EmbeddedMetadata = { title: null, artists: null, album: null, lyrics: null, cover: null }

function formatLrcTimestamp(milliseconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(milliseconds / 10))
  const minutes = Math.floor(totalCentiseconds / 6000)
  const seconds = Math.floor((totalCentiseconds % 6000) / 100)
  const centiseconds = totalCentiseconds % 100
  return `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}]`
}

function toLyricsText(tags: ILyricsTag[] | undefined): string | null {
  for (const tag of tags ?? []) {
    const synced = tag.syncText.filter(line => typeof line.timestamp === 'number')
    if (synced.length > 0) {
      return synced.map(line => `${formatLrcTimestamp(line.timestamp!)}${line.text}`).join('\n')
    }
    if (tag.text?.trim()) {
      return tag.text.trim()
    }
  }
  return null
}

/**
 * Reads the tags and front cover embedded in an audio file (ID3, Vorbis comments, MP4 atoms, ...).
 */
export async function readEmbeddedMetadata(filePath: string): Promise<EmbeddedMetadata> {
  try {
    const { common } = await parseFile(filePath, { duration: false })
    const artists = common.artists?.length ? common.artists.join(', ') : common.artist
    return {
      title: common.title?.trim() || null,
      artists: artists?.trim() || null,
      album: common.album?.trim() || null,
      lyrics: toLyricsText(common.lyrics),
      cover: selectCover(common.picture)?.data ?? null,
    }
  }
  catch {
    // Unparseable or untagged file; the track is still stored without metadata.
    return emptyEmbeddedMetadata
  }
}

export async function probeDurationSeconds(buffer: Buffer): Promise<number | null> {
  let dir: string | null = null
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'audoria-probe-'))
    const filePath = path.join(dir, 'track.bin')
    await writeFile(filePath, buffer)
    return await probeDurationSecondsFromFile(filePath)
  }
  catch {
    return null
  }
  finally {
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
  return null
}
