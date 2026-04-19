import type { Track } from './db.js'
import { AutoModel, AutoProcessor, RawImage } from '@huggingface/transformers'
import sharp from 'sharp'
import { readStoredTrackCoverBuffer } from './storage.js'

type MaskLayer = 'foreground' | 'background'

interface CoverMaskBundle {
  background: Buffer
  foreground: Buffer
}

const MODEL_ID = 'onnx-community/BiRefNet_lite'

let modelPromise: Promise<{
  model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>
}> | null = null

const coverMaskCache = new Map<string, Promise<CoverMaskBundle>>()

async function getMaskModel() {
  if (!modelPromise) {
    modelPromise = (async () => ({
      model: await AutoModel.from_pretrained(MODEL_ID, { dtype: 'fp32' }),
      processor: await AutoProcessor.from_pretrained(MODEL_ID),
    }))()
  }
  return await modelPromise
}

async function generateCoverMaskBundle(record: Track): Promise<CoverMaskBundle> {
  const contentType = record.coverContentType ?? 'image/webp'
  const coverBuffer = await readStoredTrackCoverBuffer(record)
  const blobInput = new Uint8Array(coverBuffer.byteLength)
  blobInput.set(coverBuffer)
  const image = await RawImage.read(new Blob([blobInput], { type: contentType }))
  const { model, processor } = await getMaskModel()
  const { pixel_values } = await processor(image)
  const { output_image } = await model({ input_image: pixel_values })
  const mask = await RawImage.fromTensor(output_image[0].sigmoid().mul(255).to('uint8')).resize(image.width, image.height)

  const rawMask = Buffer.from(mask.data)
  const foreground = await sharp(rawMask, {
    raw: {
      width: mask.width,
      height: mask.height,
      channels: mask.channels,
    },
  }).png().toBuffer()

  const background = await sharp(rawMask, {
    raw: {
      width: mask.width,
      height: mask.height,
      channels: mask.channels,
    },
  }).negate().png().toBuffer()

  return { foreground, background }
}

export async function getTrackCoverMask(record: Track, layer: MaskLayer): Promise<Buffer> {
  let cached = coverMaskCache.get(record.id)
  if (!cached) {
    cached = generateCoverMaskBundle(record).catch((error) => {
      coverMaskCache.delete(record.id)
      throw error
    })
    coverMaskCache.set(record.id, cached)
  }

  const bundle = await cached
  return layer === 'background' ? bundle.background : bundle.foreground
}
