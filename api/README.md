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

The music import flow now uses `@jannchie/mdl-sdk` directly and no longer requires a local Python virtual environment.
The worker streams imported audio directly to S3-compatible storage without writing temporary audio files to disk.

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
