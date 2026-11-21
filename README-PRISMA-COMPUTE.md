# Nixi/APiX prepared for Prisma Compute


This project now declares a Prisma Compute service using Prisma Composer. It provisions Prisma Postgres and stores the application's existing JSON-shaped data in one PostgreSQL JSONB row, so the current frontend/API data structure is preserved while replacing ephemeral local-file storage.


## How to deploy

1. Open this folder in your project workspace/repository connected to Prisma Compute.
2. Install dependencies using Bun or npm (`bun install` is preferred for Prisma Compute Composer apps).
3. Build the bundle: `bun run build`.
4. Set project environment secrets `NIXI_SESSION_SECRET` and `NIXI_ADMIN_KEY` (use strong random values, not the demo defaults). The service maps them to protected Composer inputs.
5. Deploy using Prisma CLI: `npx prisma deploy` (first deploy may require sign-in and a region; this module configures `us-east-1`).
6. The module provisions a database and injects its URL into the Nixi service. No `DATABASE_URL` environment variable is used by the server.
7. Inspect service logs in the Prisma Compute Console if startup fails.


## Local Compute testing

Run `bun run build`, then `npx prisma dev module.ts`. Prisma's local Compute workflow provisions a local database. Use the URL printed for the `nixi` service to test the website/API.


## Data migration note

The included `data/db.json` is imported once only if the PostgreSQL state row does not exist. This archive's seed JSON currently has an empty users list. If your live Compute database already contains users, deploying this module creates/uses its own database resource and does **not** automatically migrate the live database's existing accounts. Keep your current deployment/database unchanged until you've confirmed a backup/export and migration plan.


## Storage note

Receipt uploads are still saved under the service's local `uploads` directory. Compute's service filesystem should not be treated as permanent storage; receipt files need a persistent object-storage bucket if they must survive restarts/redeploys. The main account, balances, and transaction data are persisted in PostgreSQL.


### Secret setup
Create long random values for the two secrets. For example, on Windows PowerShell, use `([guid]::NewGuid().ToString()+[guid]::NewGuid().ToString())` for the session secret. Set them in the Prisma project environment before deploying. Do not share them in screenshots or chat.
