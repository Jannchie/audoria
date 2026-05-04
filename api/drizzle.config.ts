import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './api/src/db/schema.ts',
  out: './api/drizzle',
})
