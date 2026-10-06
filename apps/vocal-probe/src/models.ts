export type PrimaryStem = 'Vocals' | 'Instrumental'

export interface MdxParams {
  nFft: number
  hop: number
  dimF: number
  dimT: number
  compensate: number
  primaryStem: PrimaryStem
}

export interface ModelPreset {
  id: string
  label: string
  url: string
  bytes: number
  params: MdxParams
}

// Params come from UVR's mdx_model_data/model_data.json, looked up by the md5 of the
// model file's last 10,000 KiB (UVR's own hashing scheme).
export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'voc-ft',
    label: 'UVR-MDX-NET-Voc_FT',
    url: 'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR-MDX-NET-Voc_FT.onnx',
    bytes: 66_762_490,
    params: { nFft: 7680, hop: 1024, dimF: 3072, dimT: 256, compensate: 1.021, primaryStem: 'Vocals' },
  },
  {
    id: 'mdx-9482',
    label: 'UVR_MDXNET_9482',
    url: 'https://huggingface.co/Blane187/all_public_uvr_models/resolve/main/UVR_MDXNET_9482.onnx',
    bytes: 29_704_436,
    // UVR lists n_fft 6144 for this file (hash 0ddfc0eb…), not the commonly quoted 4096.
    params: { nFft: 6144, hop: 1024, dimF: 2048, dimT: 256, compensate: 1.035, primaryStem: 'Vocals' },
  },
]

export const MODEL_CACHE_NAME = 'vocal-probe-models-v1'
