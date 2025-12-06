import { defineConfig } from '@hey-api/openapi-ts'

const OPENAPI_URL = process.env.OPENAPI_URL ?? 'http://localhost:8787/openapi.json'
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8787'

export default defineConfig({
  input: OPENAPI_URL,
  output: 'src/api',
  plugins: [
    '@hey-api/typescript',
    '@hey-api/client-fetch',
    {
      name: '@hey-api/sdk',
      baseUrl: API_BASE_URL,
      output: {
        path: 'src/api/sdk.gen.ts',
      },
    },
  ],
})
