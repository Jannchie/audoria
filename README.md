<p align="center">
  <img src="web/public/audoria.svg" width="128" height="128" alt="Audoria" />
</p>

<h1 align="center">Audoria</h1>

<p align="center">A personal music library and player.</p>

## Install

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

Create the project root `.env` from `.env.example` before starting development.

This starts the API server, import worker, and web app concurrently.

## Project Structure

- `api/` — Backend API server and import worker
- `web/` — Frontend web application

## Worker

The import flow uses an asynchronous worker. `pnpm dev` starts everything together. To run the worker separately:

```bash
pnpm -C api worker
```
