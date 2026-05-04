<p align="center">
  <img src="../web/public/audoria.svg" width="96" height="96" alt="Audoria API" />
</p>

## Overview

The API package is the Node backend for Audoria.

It provides:

- the HTTP API
- the import worker
- database access
- storage integration

The repo default is:

- SQLite for database storage
- R2 through the S3-compatible API for object storage

## Development

From the repository root:

```bash
pnpm install
pnpm dev
```

This starts:

- the API server
- the import worker
- the web app

If you only want the API package processes:

```bash
pnpm -C api dev
pnpm -C api worker
```

## Configuration

Environment variables are loaded from the repository root `.env`.

Runtime settings saved from the web UI are written to:

- `api/data/app-config.json`
- `api/data/secrets.json`

## Database

### Default SQLite mode

```bash
DB_TYPE=sqlite
DB_PATH=./api/data/audoria.sqlite
```

### Optional D1 mode

```bash
DB_TYPE=d1
D1_ACCOUNT_ID=...
D1_DATABASE_ID=...
D1_API_TOKEN=...
```

When using D1, apply `api/drizzle/0000_initial.sql` before starting the app.

Generate new migrations with:

```bash
pnpm db:generate
```

## Storage

### Default R2 / S3-compatible mode

```bash
STORAGE_BACKEND=s3
S3_BUCKET=...
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false
```

### Optional filesystem mode

```bash
STORAGE_BACKEND=fs
STORAGE_FS_ROOT=./api/data/storage
```

## Import Sources

```bash
MUSICDL_SOURCES=NeteaseMusicClient,QQMusicClient,KuwoMusicClient,MiguMusicClient,JamendoMusicClient
MUSICDL_URL_SOURCES=Bilibili,Youtube
MUSICDL_SEARCH_TIMEOUT_MS=30000
MUSICDL_DOWNLOAD_TIMEOUT_MS=180000
```

## Maintenance

Backfill missing duration metadata:

```bash
pnpm -C api backfill:duration
```

Backfill missing source identifiers:

```bash
pnpm -C api backfill:source-identifier
```
