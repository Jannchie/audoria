import vue from '@vitejs/plugin-vue'
import { defaultClientConditions, defineConfig } from 'vite'

export default defineConfig({
  // Relative asset paths, so the build can be served from any subpath or opened as static files.
  base: './',
  plugins: [vue()],
  resolve: {
    // Workspace packages are bundled from their source.
    conditions: ['source', 'onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
  },
  optimizeDeps: {
    // Pre-bundling would pick ONNX Runtime's build with the .wasm inlined.
    exclude: ['onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5873,
  },
})
