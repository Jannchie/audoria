import { drizzle } from 'drizzle-orm/d1'
import { setDb } from './index.js'
import * as schema from './schema.js'

export function initD1(d1Binding: any): void {
  const drizzleDb = drizzle(d1Binding, { schema })
  setDb(drizzleDb, 'd1')

  // D1 doesn't support raw SQL migration the same way as better-sqlite3.
  // Tables must be created via a migration file or the D1 console.
  //
  // See SQL schema in db/schema.ts or run the following in D1 console:
  //   npx wrangler d1 execute audoria-db --file=migrations/001_create_tables.sql
}
