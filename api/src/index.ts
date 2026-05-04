import type { ApiReferenceConfiguration } from '@scalar/hono-api-reference'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { initRuntimeDb } from './db/runtime.js'
import { api, config } from './routes.js'

initRuntimeDb()

// ── Mount API under /api/v1, then serve frontend SPA ──
const app = new OpenAPIHono()
app.route('/api/v1', api)

// ── In production, serve frontend SPA from the same origin ──
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendDistPath = path.join(__dirname, '../../web/dist')

if (existsSync(frontendDistPath)) {
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
  }

  app.get('*', async (c) => {
    const reqPath = new URL(c.req.url).pathname
    const filePath = reqPath === '/' ? '/index.html' : reqPath
    const fullPath = path.join(frontendDistPath, filePath)

    if (fullPath.startsWith(frontendDistPath) && existsSync(fullPath)) {
      const ext = path.extname(fullPath)
      const content = readFileSync(fullPath)
      return c.body(content, 200, {
        'Content-Type': mimeTypes[ext] ?? 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      })
    }

    // SPA fallback: serve index.html for client-side routes
    const indexPath = path.join(frontendDistPath, 'index.html')
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath)
      return c.body(content, 200, { 'Content-Type': 'text/html' })
    }

    return c.json({ message: 'Not Found' }, 404)
  })
}
else {
  app.get('/', c => c.json({ status: 'ok' }))
}

api.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Audoria API',
    version: '1.0.0',
  },
})

type ScalarDocsConfig = Partial<ApiReferenceConfiguration> & {
  spec?: {
    url?: string
    content?: string
  }
}

const docsMiddleware = Scalar({
  spec: {
    url: '/openapi.json',
  },
  pageTitle: 'Audoria API Reference',
} as ScalarDocsConfig)

api.get('/docs', docsMiddleware)

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.warn(`Server is running on http://localhost:${info.port}`)
  },
)
