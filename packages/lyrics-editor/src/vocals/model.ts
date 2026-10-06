/** How an UVR MDX-Net model wants its input; from UVR's model_data.json, keyed by the model file's hash. */
export interface MdxParams {
  nFft: number
  hop: number
  dimF: number
  dimT: number
  /** Gain UVR applies to the separated stem. */
  compensate: number
}

export interface VocalModel {
  name: string
  url: string
  params: MdxParams
}

export const VOCAL_MODEL: VocalModel = {
  name: 'UVR-MDX-NET-Voc_FT',
  url: 'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-MDX-NET-Voc_FT.onnx',
  params: { nFft: 7680, hop: 1024, dimF: 3072, dimT: 256, compensate: 1.021 },
}

/** Cache API store the model file is kept in, so it is downloaded once per browser. */
export const MODEL_CACHE = 'audoria-vocal-models-v1'
