import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { env } from 'node:process'

// Keep tests away from any real storage / database configuration.
const root = mkdtempSync(path.join(tmpdir(), 'audoria-test-'))
env.DB_TYPE = 'sqlite'
env.DB_PATH = path.join(root, 'test.sqlite')
env.STORAGE_BACKEND = 'fs'
env.STORAGE_FS_ROOT = path.join(root, 'storage')
