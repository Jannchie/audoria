import path from 'node:path'
import { AutoModel, AutoProcessor, env, RawImage } from '@huggingface/transformers'
import sharp from 'sharp'
import { appDataDir } from './config.js'

// Keep downloaded models in the data volume so a recreated container does not
// have to fetch them again.
env.cacheDir = path.join(appDataDir, 'models')

const MODEL_ID = 'onnx-community/BiRefNet_lite'
const MASK_CONTENT_TYPE = 'image/png'

let modelPromise: Promise<{
  model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>
}> | null = null

async function loadMaskModel() {
  return {
    // onnxruntime's CPU arena keeps the inference peak (several GB for a 1024x1024
    // BiRefNet pass) and never returns it to the OS, so each process grew by
    // ~5GB per cover until it filled RAM and swap. Without the arena RSS stays
    // around the model size.
    model: await AutoModel.from_pretrained(MODEL_ID, {
      dtype: 'fp32',
      session_options: { enableCpuMemArena: false, enableMemPattern: false },
    }),
    processor: await AutoProcessor.from_pretrained(MODEL_ID),
  }
}

async function getMaskModel() {
  if (!modelPromise) {
    // Forget a failed load so the next cover retries instead of failing forever.
    modelPromise = loadMaskModel().catch((error: unknown) => {
      modelPromise = null
      throw error
    })
  }
  return await modelPromise
}

export async function generateCoverMaskPng(
  imageBody: Uint8Array,
  contentType: string | null = 'image/webp',
): Promise<Buffer> {
  const blobInput = new Uint8Array(imageBody.byteLength)
  blobInput.set(imageBody)
  const image = await RawImage.read(new Blob([blobInput], { type: contentType ?? 'image/webp' }))
  const { model, processor } = await getMaskModel()
  const { pixel_values } = await processor(image)
  const { output_image } = await model({ input_image: pixel_values })
  const mask = await RawImage.fromTensor(output_image[0].sigmoid().mul(255).to('uint8')).resize(image.width, image.height)

  return await sharp(Buffer.from(mask.data), {
    raw: {
      width: mask.width,
      height: mask.height,
      channels: mask.channels,
    },
  }).png().toBuffer()
}

export function getCoverMaskContentType(): string {
  return MASK_CONTENT_TYPE
}
