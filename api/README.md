<p align="center">
  <img src="../web/public/audoria.svg" width="96" height="96" alt="Audoria API" />
</p>

## Install

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

The API loads environment variables from the project root `.env`. Settings saved from the web app are written to `api/data/app-config.json` and `api/data/secrets.json`. Saved settings override environment variables for regular runtime options; secret environment variables still take precedence over saved secrets.

The music import flow now uses `@jannchie/mdl-sdk` directly and no longer requires a local Python virtual environment.
The worker stores imported audio through a configurable storage backend without writing temporary audio files to disk.

## Storage

The API activates exactly one storage backend per deployment.

### Filesystem backend

```bash
STORAGE_BACKEND=fs
STORAGE_FS_ROOT=./api/data/storage
```

Use the filesystem backend for single-node deployments or environments with a shared persistent volume.

### S3-compatible backend

```bash
STORAGE_BACKEND=s3
S3_BUCKET=audoria
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
```

S3 settings are only required when `STORAGE_BACKEND=s3`.

## Import sources

Configure the searchable music providers and URL import providers with comma-separated source names:

```bash
MUSICDL_SOURCES=NeteaseMusicClient,QQMusicClient,KuwoMusicClient,MiguMusicClient,JamendoMusicClient
MUSICDL_URL_SOURCES=Bilibili,Youtube
MUSICDL_SEARCH_TIMEOUT_MS=30000
MUSICDL_DOWNLOAD_TIMEOUT_MS=180000
```

`MUSICDL_SOURCES` controls the import page source filter and aggregate search. `MUSICDL_URL_SOURCES` controls link imports.

## AI providers

Provider API keys can be injected with each provider's default environment variable name, or saved from the web settings page. Saved keys stay in `api/data/secrets.json` and are never returned to the web client.

```bash
OPENAI_API_KEY=sk-...
```

Only OpenAI is currently supported.

## Worker

The import flow now uses an asynchronous worker. In local development, `pnpm dev` starts:

- the API server
- the import worker
- the web app

If you want to run the worker separately:

```bash
pnpm -C api worker
```

After that, the upload page can search supported `musicdl` sources, create import jobs, and wait for the worker to finish the download and library import.

## Maintenance

Backfill missing duration metadata with:

```bash
pnpm -C api backfill:duration
```

Backfill missing source identifiers for searchable music sources with:

```bash
pnpm -C api backfill:source-identifier
```
