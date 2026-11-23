# Production Deployment Guide

Step-by-step guide for deploying the AudioBlocks backend to production for
the first time. Assumes a fresh engineer with repo access and a target
environment (VM, container platform, or PaaS such as Render/Railway).

For hosting architecture decision see [ADR-012: Production and Staging Hosting Architecture](adrs/012-production-and-staging-hosting-architecture.md).
For pre-launch verification see [production-environment-checklist.md](production-environment-checklist.md).
For staging testnet parity see [staging-production-parity.md](staging-production-parity.md).
For sizing and scaling details see [deployment-and-scaling.md](deployment-and-scaling.md).
For disaster recovery see [runbooks/disaster-recovery.md](runbooks/disaster-recovery.md).

## 1. Provision infrastructure

You need:

- **PostgreSQL 14+** database
- **Redis** (cache, rate limiting, job queue)
- **RabbitMQ** (song-processing queue; API starts without it but workers will not run)
- **AWS S3** bucket for uploads, HLS segments, and cover art
- **Pinata** IPFS credentials for metadata pinning
- Optional: **Privy** app credentials if delegated auth is enabled

## 2. Configure environment variables

Copy `.env.example` to your secret store and fill in every required value.
The full list is documented in the README's
[Environment Variables](../README.md#environment-variables) section and in
[environment-variables.md](environment-variables.md). At minimum:

```bash
NODE_ENV=production
PORT=4000
POSTGRES_HOST= POSTGRES_PORT= POSTGRES_USER= POSTGRES_PASSWORD= POSTGRES_DATABASE=
REDIS_HOST= REDIS_PORT= REDIS_USERNAME= REDIS_PASSWORD=
RABBITMQ_URL=
JWT_SECRET=
AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_REGION= AWS_BUCKET_NAME=
PINATA_JWT= PINATA_GATEWAY=
SOROBAN_NETWORK=mainnet
SOROBAN_MAINNET_RPC_URL= SOROBAN_MAINNET_NETWORK_PASSPHRASE=
SOROBAN_MAINNET_NFT_CONTRACT_ID= SOROBAN_MAINNET_ARTIST_CONTRACT_ID=
SOROBAN_MAINNET_CATALOG_CONTRACT_ID= SOROBAN_MAINNET_ROYALTY_CONTRACT_ID=
SOROBAN_MAINNET_MARKETPLACE_CONTRACT_ID=
```

Auth mode: leave all `PRIVY_*` variables unset to run in `legacy` mode, or set
`PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and `AUTH_MODE=both` for a staged Privy
rollout (see README → Privy Integration Setup).

The app validates required env vars at startup and exits immediately if any
are missing.

## 3. Build and deploy

```bash
npm ci
npm run build          # outputs to dist/
npm start              # node dist/index.js — runs migrations on boot in production
```

Or use Docker:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The HTTP server binds and passes health checks before connecting to
RabbitMQ, so deploy platforms will report healthy even if the broker is
briefly unavailable.

## 4. Verify the deployment

```bash
curl https://<host>/api/health
```

Then smoke-test:

- `POST /api/auth/register-email` (or a Privy login) → returns a JWT
- `GET /api/song/stream/<known-song-id>` → returns an HLS manifest
- Confirm the worker is consuming: check logs for `SongProcessorWorker`
  startup and RabbitMQ queue depth (`docs/queue-depth` monitoring,
  `monitoring/` Prometheus rules)

## 5. Post-deploy checklist

- [ ] Migrations applied (`npm run migration:run` if not auto-run)
- [ ] Genre seeder ran (automatic on boot)
- [ ] S3 bucket lifecycle rule for `uploads/raw/` configured (see README →
      S3 Storage and Lifecycle Management)
- [ ] Webhook subscriptions re-registered by clients if URLs changed
- [ ] Monitoring/alerting dashboards connected (`monitoring/`)
- [ ] `AUTH_MODE` reviewed — flip to `privy` only after staged rollout

## Rollback and Zero-Downtime Verification

Deployments are executed with zero downtime using rolling updates (MinimumHealthyPercent = 100%, MaximumPercent = 200%) and gated by automated health probes (`/health/live`, `/health/ready`, `/health/worker`).

Automated health verification and rollback is managed via:
```bash
./scripts/deploy-verify-rollback.sh --url https://api.audioblocks.io --timeout 120 --interval 5 --environment production
```
If readiness fails within the timeout window, the deployment is automatically aborted and rolled back to the previous stable revision. For recorded drills and failure scenarios, see [runbooks/rollback-drill-record.md](runbooks/rollback-drill-record.md).

For manual rollback, redeploy the previous image/tag. For schema rollback use
`npm run migration:revert` only if the release shipped a reversible
migration; otherwise roll forward with a fix.
