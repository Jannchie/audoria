import { OpenAPIHono } from '@hono/zod-openapi'
import { initD1 } from './db/d1.js'
import { api } from './routes.js'

// Inline type for Cloudflare Workers D1 binding
interface CfEnv {
  DB: any
}

export default {
  async fetch(request: Request, env: CfEnv): Promise<Response> {
    initD1(env.DB)

    const app = new OpenAPIHono()
    app.route('/api/v1', api)
    app.get('/', c => c.json({ status: 'ok' }))

    return app.fetch(request)
  },
}
