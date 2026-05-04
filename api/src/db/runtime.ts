import { config } from '../config.js'
import { initD1Remote } from './d1Remote.js'
import { initSqlite } from './sqlite.js'

let initialized = false

export function initRuntimeDb(): void {
  if (initialized) {
    return
  }

  if (config.dbType === 'd1') {
    if (!config.d1) {
      throw new Error('D1 configuration is missing')
    }
    initD1Remote(config.d1)
  }
  else {
    initSqlite(config.dbPath)
  }

  initialized = true
}
