set shell := ["bash", "-cu"]

web-dev:
    pnpm --dir web dev

api-dev:
    pnpm --dir api dev

gen-sdk:
    pnpm --dir web run gen:sdk