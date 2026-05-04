#!/bin/sh
set -e

# Ensure data directory exists
mkdir -p /app/api/data

# Start the import worker in the background
echo "[entrypoint] Starting import worker..."
node /app/api/dist/worker.js &
WORKER_PID=$!

# Start the API server (serves both API and frontend) in the foreground
echo "[entrypoint] Starting API server on port ${PORT:-8787}..."
exec node /app/api/dist/index.js
