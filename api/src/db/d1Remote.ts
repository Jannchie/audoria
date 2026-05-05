import type { D1HttpConfig } from '../config.js'
import { drizzle } from 'drizzle-orm/d1'
import { setDb } from './index.js'
import * as schema from './schema.js'

interface D1Meta {
  changed_db?: boolean
  changes?: number
  duration?: number
  last_row_id?: number
  rows_read?: number
  rows_written?: number
  size_after?: number
  served_by?: string
  timings?: Record<string, number>
}

interface D1QueryResult {
  success: boolean
  results: Record<string, unknown>[]
  meta?: D1Meta
}

interface D1RawResult {
  success: boolean
  results: unknown[][]
  meta?: D1Meta
}

interface D1ApiEnvelope<T> {
  success: boolean
  result: T | T[]
  errors?: Array<{ message?: string }>
  messages?: Array<{ message?: string }>
}

type D1Value = string | number | boolean | null | ArrayBuffer | Uint8Array

interface D1PreparedStatementLike {
  bind: (...values: D1Value[]) => D1PreparedStatementLike
  first: <T = Record<string, unknown>>(columnName?: string) => Promise<T | null>
  run: <T = D1QueryResult>() => Promise<T>
  all: <T = D1QueryResult>() => Promise<T>
  raw: <T = unknown[]>() => Promise<T[]>
}

interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike
  batch: <T = D1QueryResult>(statements: D1PreparedStatementLike[]) => Promise<T[]>
  exec: (query: string) => Promise<D1QueryResult>
}

function toErrorMessage(status: number, body: string): string {
  const trimmed = body.trim()
  if (trimmed) {
    return `D1 API request failed with ${status}: ${trimmed}`
  }
  return `D1 API request failed with ${status}`
}

function normalizeApiResult<T>(payload: D1ApiEnvelope<T>): T[] {
  if (!payload.success) {
    const messages = [
      ...(payload.errors ?? []).map(item => item.message).filter(Boolean),
      ...(payload.messages ?? []).map(item => item.message).filter(Boolean),
    ]
    throw new Error(messages[0] ?? 'D1 API request was not successful')
  }

  return Array.isArray(payload.result) ? payload.result : [payload.result]
}

class D1RemotePreparedStatement implements D1PreparedStatementLike {
  constructor(
    private readonly client: D1RemoteDatabase,
    private readonly query: string,
    private readonly params: D1Value[] = [],
  ) {}

  bind(...values: D1Value[]): D1PreparedStatementLike {
    return new D1RemotePreparedStatement(this.client, this.query, values)
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const result = await this.all<D1QueryResult>()
    const firstRow = result.results[0] as Record<string, unknown> | undefined
    if (!firstRow) {
      return null
    }
    if (columnName) {
      return (firstRow[columnName] as T | undefined) ?? null
    }
    return firstRow as T
  }

  async run<T = D1QueryResult>(): Promise<T> {
    return await this.client.querySingle<T>('query', this.query, this.params)
  }

  async all<T = D1QueryResult>(): Promise<T> {
    return await this.client.querySingle<T>('query', this.query, this.params)
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const result = await this.client.querySingle<D1RawResult>('raw', this.query, this.params)
    return result.results as T[]
  }

  toJSON(): { sql: string, params: D1Value[] } {
    return {
      sql: this.query,
      params: this.params,
    }
  }
}

class D1RemoteDatabase implements D1DatabaseLike {
  private readonly baseUrl: string
  private readonly headers: HeadersInit

  constructor(private readonly config: D1HttpConfig) {
    this.baseUrl = `${config.apiBaseUrl.replace(/\/+$/, '')}/accounts/${config.accountId}/d1/database/${config.databaseId}`
    this.headers = {
      'Authorization': `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
    }
  }

  prepare(query: string): D1PreparedStatementLike {
    return new D1RemotePreparedStatement(this, query)
  }

  async batch<T = D1QueryResult>(statements: D1PreparedStatementLike[]): Promise<T[]> {
    const batch = statements.map((statement) => {
      if (!(statement instanceof D1RemotePreparedStatement)) {
        throw new TypeError('Unsupported D1 prepared statement implementation')
      }
      return statement.toJSON()
    })
    return await this.queryMany<T>('query', { batch })
  }

  async exec(query: string): Promise<D1QueryResult> {
    return await this.querySingle<D1QueryResult>('query', query, [])
  }

  async querySingle<T>(endpoint: 'query' | 'raw', sql: string, params: D1Value[]): Promise<T> {
    const [result] = await this.queryMany<T>(endpoint, { sql, params })
    if (!result) {
      throw new Error('D1 API returned no result')
    }
    return result
  }

  private async queryMany<T>(
    endpoint: 'query' | 'raw',
    body: { sql: string, params: D1Value[] } | { batch: Array<{ sql: string, params: D1Value[] }> },
  ): Promise<T[]> {
    const response = await fetch(`${this.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(toErrorMessage(response.status, await response.text()))
    }

    const payload = await response.json() as D1ApiEnvelope<T>
    return normalizeApiResult(payload)
  }
}

export function initD1Remote(config: D1HttpConfig): void {
  const client = new D1RemoteDatabase(config)
  const drizzleDb = drizzle(client as never, { schema })
  setDb(drizzleDb, 'd1')
}
