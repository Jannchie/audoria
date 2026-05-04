import { drizzle } from 'drizzle-orm/d1';
import { setDb } from './index.js';
import * as schema from './schema.js';
function toErrorMessage(status, body) {
    const trimmed = body.trim();
    if (trimmed) {
        return `D1 API request failed with ${status}: ${trimmed}`;
    }
    return `D1 API request failed with ${status}`;
}
function normalizeApiResult(payload) {
    if (!payload.success) {
        const messages = [
            ...(payload.errors ?? []).map(item => item.message).filter(Boolean),
            ...(payload.messages ?? []).map(item => item.message).filter(Boolean),
        ];
        throw new Error(messages[0] ?? 'D1 API request was not successful');
    }
    return Array.isArray(payload.result) ? payload.result : [payload.result];
}
class D1RemotePreparedStatement {
    client;
    query;
    params;
    constructor(client, query, params = []) {
        this.client = client;
        this.query = query;
        this.params = params;
    }
    bind(...values) {
        return new D1RemotePreparedStatement(this.client, this.query, values);
    }
    async first(columnName) {
        const result = await this.all();
        const firstRow = result.results[0];
        if (!firstRow) {
            return null;
        }
        if (columnName) {
            return firstRow[columnName] ?? null;
        }
        return firstRow;
    }
    async run() {
        return await this.client.querySingle('query', this.query, this.params);
    }
    async all() {
        return await this.client.querySingle('query', this.query, this.params);
    }
    async raw() {
        const result = await this.client.querySingle('raw', this.query, this.params);
        return result.results;
    }
    toJSON() {
        return {
            sql: this.query,
            params: this.params,
        };
    }
}
class D1RemoteDatabase {
    config;
    baseUrl;
    headers;
    constructor(config) {
        this.config = config;
        this.baseUrl = `${config.apiBaseUrl.replace(/\/+$/, '')}/accounts/${config.accountId}/d1/database/${config.databaseId}`;
        this.headers = {
            Authorization: `Bearer ${config.apiToken}`,
            'Content-Type': 'application/json',
        };
    }
    prepare(query) {
        return new D1RemotePreparedStatement(this, query);
    }
    async batch(statements) {
        const batch = statements.map((statement) => {
            if (!(statement instanceof D1RemotePreparedStatement)) {
                throw new TypeError('Unsupported D1 prepared statement implementation');
            }
            return statement.toJSON();
        });
        return await this.queryMany('query', { batch });
    }
    async exec(query) {
        return await this.querySingle('query', query, []);
    }
    async querySingle(endpoint, sql, params) {
        const [result] = await this.queryMany(endpoint, { sql, params });
        if (!result) {
            throw new Error('D1 API returned no result');
        }
        return result;
    }
    async queryMany(endpoint, body) {
        const response = await fetch(`${this.baseUrl}/${endpoint}`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(toErrorMessage(response.status, await response.text()));
        }
        const payload = await response.json();
        return normalizeApiResult(payload);
    }
}
export function initD1Remote(config) {
    const client = new D1RemoteDatabase(config);
    const drizzleDb = drizzle(client, { schema });
    setDb(drizzleDb, 'd1');
}
