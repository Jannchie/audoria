import { defaultClientConditions, defineConfig } from 'vite'

// Cross-origin isolation enables SharedArrayBuffer, i.e. multi-threaded wasm, so the wasm
// backend is measured fairly. `credentialless` keeps CORS-enabled CDN fetches working.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig({
  base: './',
  resolve: {
    // Picks ort.webgpu.min.mjs, which loads its .wasm from `env.wasm.wasmPaths` at runtime
    // instead of the bundle build that inlines a ~25 MB asset.
    conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5874,
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
})
