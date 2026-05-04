<p align="center">
  <img src="web/public/audoria.svg" width="128" height="128" alt="Audoria" />
</p>

<h1 align="center">Audoria</h1>

<p align="center">A personal music library and player.</p>

## Overview

Audoria runs as a Node application that serves:

- the backend API
- the import worker
- the built frontend SPA

For production, the recommended shape is:

- Docker for the app runtime
- SQLite for the application database
- Cloudflare R2 via the S3-compatible API

## Prerequisites

- Docker and Docker Compose
- A Cloudflare R2 bucket with S3 API credentials
- A `.env` file created from `.env.example`

## Quick Start

1. Create your environment file:

```bash
cp .env.example .env
```

2. Fill in these required values:

```bash
DB_TYPE=sqlite
DB_PATH=./api/data/audoria.sqlite

STORAGE_BACKEND=s3
S3_BUCKET=...
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
SECRET_KEY=...
```

3. Build and start the container:

```bash
pnpm docker:build
pnpm docker:up
```

4. Open the app:

```text
http://localhost:8787
```

The API is served from:

```text
http://localhost:8787/api/v1
```

## Default Deployment

The default deployment mode is:

- SQLite stored in `./api/data/audoria.sqlite`
- R2 for music files and cover assets
- one container running both the API server and the import worker

Persist `./api/data` with a Docker volume or bind mount so the database survives container restarts.

## Optional D1 Setup

If you want to use Cloudflare D1 instead of local SQLite, change your `.env`:

```bash
DB_TYPE=d1
D1_ACCOUNT_ID=...
D1_DATABASE_ID=...
D1_API_TOKEN=...
```

Audoria does not create D1 tables automatically. Apply `api/drizzle/0000_initial.sql`
through the Cloudflare dashboard, API, or any D1 management workflow you prefer before
starting the app.

After changing `api/src/db/schema.ts`, generate a new migration:

```bash
pnpm db:generate
```

Then apply the generated SQL to D1.

## Local Development

For local development, SQLite is already the default database backend.

If you also want to avoid R2, switch storage to the local filesystem:

```bash
STORAGE_BACKEND=fs
STORAGE_FS_ROOT=./api/data/storage
```

Then run:

```bash
pnpm install
pnpm dev
```

This starts:

- the API server
- the import worker
- the Vite frontend dev server

## Docker Notes

- `docker-entrypoint.sh` starts the import worker in the background and the API server in the foreground.
- `docker-compose.yml` mounts `./api/data` into the container so runtime settings remain available across restarts.
- `ffmpeg` is installed in the runtime image so `ffprobe`-based duration detection can run.
- `pnpm db:generate` requires the root dev dependency `drizzle-kit`, which is already included in this workspace.

## Project Structure

- `api/` — backend API, import worker, database, storage
- `web/` — frontend SPA
- `Dockerfile` — production container build
- `docker-compose.yml` — local container orchestration
