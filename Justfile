set shell := ["bash", "-cu"]

dev-web:
    pnpm --dir web dev

dev-api:
    pnpm --dir api dev
