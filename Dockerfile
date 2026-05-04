# ============================================================
# Stage 1: Build
# ============================================================
FROM node:22-slim AS builder

WORKDIR /app

# Enable pnpm via corepack (reads version from packageManager in package.json)
RUN corepack enable && corepack prepare pnpm --activate

# Install build toolchain for native modules (better-sqlite3, sharp, etc.)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first (better Docker layer caching)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY api/package.json ./api/
COPY web/package.json ./web/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY api/ ./api/
COPY web/ ./web/

# Build frontend (VITE_API_BASE="" = same-origin requests to the backend)
ARG VITE_API_BASE="/api/v1"
ENV VITE_API_BASE=$VITE_API_BASE
RUN pnpm -C web build

# Build backend (tsc -> dist/)
RUN pnpm -C api build

# ============================================================
# Stage 2: Runtime
# ============================================================
FROM node:22-slim AS runtime

WORKDIR /app

# Install runtime OS dependencies (e.g., for better-sqlite3 native bindings)
# none needed in slim image for these packages

# Copy built artifacts from builder
COPY --from=builder /app/api/dist ./api/dist
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/api/node_modules ./api/node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/api/package.json ./api/package.json

# Copy entrypoint
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directory for SQLite and runtime config
RUN mkdir -p /app/api/data

EXPOSE 8787

ENTRYPOINT ["/docker-entrypoint.sh"]
