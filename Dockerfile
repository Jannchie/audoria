FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm -C web build
RUN pnpm -C api build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/api/node_modules ./api/node_modules
COPY --from=builder /app/api/dist ./api/dist
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/api/package.json ./api/package.json
COPY --from=builder /app/web/package.json ./web/package.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh \
  && mkdir -p /app/api/data

EXPOSE 8787

ENTRYPOINT ["./docker-entrypoint.sh"]
