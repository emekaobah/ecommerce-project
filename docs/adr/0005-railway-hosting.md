# 5. Host the backend on Railway

Status: accepted, 2026-10-02

## Context

The spec (#2) and design chose Render, and the walking skeleton wrote a `render.yaml` Blueprint that was never applied. Before deploying (#19), the backend's real requirements were checked against current pricing.

Facts that shaped the decision (checked 2026-10-02):

- Mercur's self-host guide (`@mercurjs/docs`, `resources/deployment/self-host.mdx`) asks for two API instances, a server and a worker, with **at least 2 GB RAM each**, plus Postgres and Redis. The Blueprint used Render's 512 MB Starter instances.
- Render bills per instance size. At 2 GB (Standard, $25) for both the server and the worker, plus Postgres (~$19) and Key Value ($10), it comes to about $79 a month before any traffic.
- Railway bills RAM and CPU actually used, per second ($10/GB-month, $20/vCPU-month), on a $5 Hobby plan that includes $5 of usage. The 2 GB is a ceiling, not a charge, so an idle pre-launch backend costs about $15–35 a month.
- Railway's Infrastructure as Code (`.railway/railway.ts`, generally available) describes the services, databases, region and variables in one file, like a Blueprint. Its older `railway.json` is deprecated and stops being read on 2026-12-01.
- Railway's closest region to Lagos is EU West (Amsterdam). Render's was Frankfurt.

## Decision

Host the backend on Railway, described by `.railway/railway.ts`:

- `oja-api` (server mode, `/health` check, pre-deploy migrations) and `oja-worker` (worker mode), both built from `main` with the same build.
- `oja-db`: Postgres 16, pinned to match `docker-compose.yml`. The SDK's default is 18.
- `oja-redis`: Railway's Redis. Its `maxmemory-policy` is Redis's default, `noeviction`, which BullMQ needs.
- Everything in `europe-west4-drams3a`.
- Secrets and public URLs are environment shared variables, set by hand and referenced from the file, so none are committed.

Files stay on Cloudflare R2. Railway Buckets were not evaluated.

## Consequences

- Cost tracks use. Watch the usage dashboard once real traffic arrives, and set a usage limit.
- The file is applied from the CLI (`railway config plan` / `apply`, CLI 5.42.1 or newer), not read on deploy. A GitHub Action (`railwayapp/config`) can plan on PRs and apply on merge later.
- Railway's Redis is Redis 8. Local development keeps Valkey 8, which is protocol-compatible.
- If Railway stops fitting, the same two-instance shape moves to any host. Only `.railway/railway.ts` is Railway-specific.
