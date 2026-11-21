# Nixi / APiX Website — Prisma Compute version

This package keeps the existing Nixi website design and API routes and adds a Prisma Compute/Composer declaration with a PostgreSQL database. The main application state (users, balances, transactions, settings, and requests) is stored in PostgreSQL rather than a local `db.json` file.


## Read before deploying

This is a Prisma Compute project, not the old `npm start`/JSON-file setup. Follow `README-PRISMA-COMPUTE.md`. Do not replace your currently running deployment until you have backed up any live users and verified the new preview.


## What is included

- Existing site files and branding
- Existing API routes and admin panel
- Prisma Composer service and module declarations
- PostgreSQL JSONB state storage
- Secret inputs for session signing and admin access
- Compute build/deployment configuration


## Demo status and security

This website is still a sandbox/manual-review demonstration, not a production payment platform. It does not verify mailbox ownership via OTP and needs security review, rate limiting, and a persistent object store for uploaded receipt files before production use.
