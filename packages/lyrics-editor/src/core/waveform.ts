/** A song's loudness envelope: the lowest and highest sample in each of `rate` buckets a second. */
export interface Peaks {
  rate: number
  min: Float32Array
  max: Float32Array
}

/** Folds the channels of decoded audio into per-bucket peaks. */
export function computePeaks(channels: Float32Array[], sampleRate: number, rate = 200): Peaks {
  const length = channels[0]?.length ?? 0
  const size = Math.ceil(length / sampleRate * rate)
  const min = new Float32Array(size)
  const max = new Float32Array(size)
  const perBucket = sampleRate / rate
  for (let bucket = 0; bucket < size; bucket++) {
    const start = Math.floor(bucket * perBucket)
    const end = Math.min(length, Math.floor((bucket + 1) * perBucket))
    let low = 0
    let high = 0
    for (const channel of channels) {
      for (let i = start; i < end; i++) {
        const sample = channel[i]
        if (sample < low) {
          low = sample
        }
        if (sample > high) {
          high = sample
        }
      }
    }
    min[bucket] = low
    max[bucket] = high
  }
  return { rate, min, max }
}

/** Decodes an encoded audio file (mp3, m4a, flac…) into peaks for drawing a waveform. */
export async function decodePeaks(data: ArrayBuffer, rate = 200): Promise<Peaks> {
  const context = new OfflineAudioContext(1, 1, 44_100)
  const buffer = await context.decodeAudioData(data)
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  return computePeaks(channels, buffer.sampleRate, rate)
}
