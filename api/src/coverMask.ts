import { AutoModel, AutoProcessor, RawImage } from '@huggingface/transformers'
import sharp from 'sharp'

const MODEL_ID = 'onnx-community/BiRefNet_lite'
const MASK_CONTENT_TYPE = 'image/png'

let modelPromise: Promise<{
  model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>
}> | null = null

async function getMaskModel() {
  if (!modelPromise) {
    modelPromise = (async () => ({
      model: await AutoModel.from_pretrained(MODEL_ID, { dtype: 'fp32' }),
      processor: await AutoProcessor.from_pretrained(MODEL_ID),
    }))()
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
