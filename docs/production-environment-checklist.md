# Production Environment Provisioning & Readiness Checklist (OPS-01)

This checklist documents the pre-launch environment provisioning requirements, security guardrails, backing infrastructure configuration, and operational ownership for the AudioBlocks production environment on Stellar Mainnet (Issue #961).

---

## 1. Ownership & RACI Matrix

| Role | Contact / Team | Responsibilities | RACI |
| :--- | :--- | :--- | :--- |
| **Platform / Infrastructure Lead** | `ops-lead@audioblocks.io` | AWS VPC, ECS cluster, Aurora Postgres, ElastiCache Redis, Amazon MQ, CI/CD pipeline | **A**ccountable |
| **Security Lead** | `security@audioblocks.io` | IAM policies, AWS Secrets Manager, KMS keys, Cloudflare WAF, audit compliance | **R**esponsible |
| **Core Backend Lead** | `backend-lead@audioblocks.io` | Application configuration, TypeORM migrations, Soroban contract addresses, API health | **R**esponsible |
| **On-Call Engineer** | PagerDuty rotation | Release monitoring, incident triage, rollback execution | **C**onsulted / **I**nformed |

---

## 2. Infrastructure & Compute Checklist

### 2.1 Network & Perimeter Security
- [ ] Dedicated AWS Production VPC created with CIDR `/16` across 3 Availability Zones (`us-east-1a`, `us-east-1b`, `us-east-1c`).
- [ ] Public subnets hosting dual Application Load Balancers (ALBs) with AWS Shield Standard DDoS protection.
- [ ] Private application subnets hosting ECS Fargate tasks with egress via redundant NAT Gateways.
- [ ] Isolated database subnets without public internet gateways.
- [ ] Security Groups configured with strict least privilege:
  - Database SG only allows ingress from ECS API/Worker security groups on port 5432.
  - Redis SG only allows ingress from ECS API security group on port 6379.
  - RabbitMQ SG only allows ingress from ECS API/Worker security groups on port 5671/5672.
- [ ] Cloudflare DNS & WAF configured in front of ALB with TLS 1.3, HSTS (`max-age=31536000`), and rate limiting rules for `/api/auth/*`.

### 2.2 Container Orchestration (AWS ECS Fargate)
- [ ] Production ECS Cluster provisioned (`audioblocks-prod`).
- [ ] ECS Service `audioblocks-api`:
  - 2 to 10 tasks autoscaling on CPU/Memory (>70%) and ALB Target Response Time.
  - Task allocation: `0.50 vCPU`, `1024 MB RAM`.
  - Rolling update configuration: `MinimumHealthyPercent = 100`, `MaximumPercent = 200`.
- [ ] ECS Service `audioblocks-song-worker`:
  - 2 to 8 tasks autoscaling on RabbitMQ queue depth (`song_upload_tasks > 10`).
  - Task allocation: `1.00 vCPU`, `2048 MB RAM` (for `fluent-ffmpeg` HLS transcoding).
- [ ] ECS Service `audioblocks-indexer`:
  - 1 singleton task with auto-restart on exit for sequential Soroban ledger indexing.
  - Task allocation: `0.50 vCPU`, `1024 MB RAM`.

### 2.3 Container Runtime Hardening
Reference configuration: `docker-compose.prod.yml` and
`docker-compose.staging.yml`, asserted by `tests/containerHardening.test.ts`.
Every setting below was verified against the pinned images (a write round-trip
for each service, and `CapEff: 0` / `NoNewPrivs: 1` / `EROFS` on a live
container), so the checklist describes a configuration that boots, not an
aspiration.

- [ ] Every container runs with a read-only root filesystem.
  - Compose: `read_only: true`. ECS/Fargate: `readonlyRootFilesystem: true` on
    every `containerDefinitions` entry.
  - The only writable paths are declared mounts. For the API that is
    `/app/uploads` (chunked uploads, merged files, HLS segments) plus a sized
    tmpfs at `/tmp`, where `os.tmpdir()` scratch lives (`src/utils/ffmpeg.ts`,
    `src/services/CoverArtService.ts`). Anything else a container needs to
    write must be added as a volume here, not by turning `read_only` off.
- [ ] All Linux capabilities are dropped; nothing is re-added except where an
  image's entrypoint provably needs it.
  - Compose: `cap_drop: [ALL]`. ECS/Fargate:
    `linuxParameters.capabilities.drop: ["ALL"]`.
  - The backend runs with zero capabilities. `postgres:15-alpine` is the only
    exception: its entrypoint starts as root to initialise PGDATA and su-execs
    down, so `CHOWN, SETUID, SETGID, FOWNER, DAC_OVERRIDE, SYS_NICE` are
    re-added. Redis and RabbitMQ avoid the same problem by running as their own
    image user (`user: redis:redis`, `user: rabbitmq:rabbitmq`) instead of
    root-and-gosu, which is what lets their capability lists stay empty.
- [ ] Privilege escalation is disabled and the process count is capped.
  - Compose: `security_opt: [no-new-privileges:true]` plus
    `deploy.resources.limits.pids` (256 backend/DB, 128 Redis, 512 RabbitMQ —
    headroom for ffmpeg and the health probe, not a concurrency limit).
    ECS/Fargate: `privileged: false`; CPU/memory ceilings per task as in §2.2.
- [ ] The image runs as a non-root user and ships no build toolchain.
  - `Dockerfile` final stage: `USER appuser`, production dependencies copied
    from the builder stage (no `npm ci` in the runtime stage, so no registry
    access and no lifecycle scripts), and `uploads/*` pre-created and chowned so
    a fresh named volume inherits ownership.
- [ ] The image is scanned on every build with the same policy as CI
  (`build-and-scan`): Trivy at `severity: CRITICAL,HIGH`,
  `ignore-unfixed: true`, failing the job on any finding.

---

## 3. Backing Services Checklist

### 3.1 Relational Database (Aurora PostgreSQL 15)
- [ ] Amazon Aurora Serverless v2 PostgreSQL 15 Multi-AZ cluster provisioned.
- [ ] Storage auto-scaling enabled with encrypted EBS volumes (KMS CMK).
- [ ] Database connection pooling configured (`DB_POOL_MAX=20` per container).
- [ ] SSL connection enforced (`ssl: { rejectUnauthorized: true }`).
- [ ] Automated daily snapshots with 30-day retention and continuous Point-In-Time Recovery (PITR).

### 3.2 Cache & Rate Limiting (ElastiCache Redis 7)
- [ ] Amazon ElastiCache for Redis 7 Multi-AZ cluster with auto-failover.
- [ ] In-transit TLS encryption and Redis Auth password configured.
- [ ] Maxmemory policy set to `volatile-lru` with 80% memory alert threshold.

### 3.3 Message Broker (Amazon MQ for RabbitMQ 3.13)
- [ ] Active/Standby broker cluster provisioned across two Availability Zones.
- [ ] TLS AMQPS endpoint (`amqps://`) enabled.
- [ ] Durable queues and dead-letter exchanges (`song_processing_dlq`) provisioned.

### 3.4 Object & Decentralized Storage
- [ ] AWS S3 bucket `audioblocks-prod-media` provisioned in `us-east-1`.
- [ ] S3 Default Encryption set to SSE-S3 or AWS KMS.
- [ ] Public access blocked at the bucket level; access granted strictly via CloudFront / presigned URLs.
- [ ] S3 Lifecycle Rule configured: `uploads/raw/*` objects expire and delete automatically after 7 days.
- [ ] Dedicated Pinata IPFS Gateway and Pinata JWT configured with dedicated rate limit tier.

---

## 4. Stellar / Soroban Mainnet Checklist

- [ ] `SOROBAN_NETWORK=mainnet` configured.
- [ ] `SOROBAN_MAINNET_RPC_URL` configured with dedicated enterprise RPC provider (QuickNode / NowNodes) with redundant secondary endpoint.
- [ ] `SOROBAN_MAINNET_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"` verified.
- [ ] Mainnet contract IDs verified against audited deployments:
  - `SOROBAN_MAINNET_NFT_CONTRACT_ID`
  - `SOROBAN_MAINNET_ARTIST_CONTRACT_ID`
  - `SOROBAN_MAINNET_CATALOG_CONTRACT_ID`
  - `SOROBAN_MAINNET_ROYALTY_CONTRACT_ID`
  - `SOROBAN_MAINNET_MARKETPLACE_CONTRACT_ID`
- [ ] Non-custodial transaction relay keypair provisioned and funded with minimum XLM reserve for transaction submission fees.

---

## 5. Security & Secrets Management

- [ ] All production secrets stored in AWS Secrets Manager and injected into container environments at runtime:
  - `JWT_SECRET` (256-bit cryptographically secure random string)
  - `POSTGRES_PASSWORD`
  - `REDIS_PASSWORD`
  - `RABBITMQ_PASS`
  - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or IAM Task Role)
  - `PINATA_JWT`
  - `PRIVY_APP_SECRET`
  - `TWITTER_CLIENT_SECRET`
- [ ] `NODE_ENV=production` verified (strictly disabling TypeORM automatic schema synchronization).
- [ ] `ALLOWED_ORIGINS` explicitly restricted to production domains (no wildcards):
  `https://audioblocks.io,https://artist.audioblocks.io,https://listener.audioblocks.io`

---

## 6. Observability & Deployment Verification

- [ ] Prometheus metrics endpoint active and scraped (`/metrics`).
- [ ] Pino structured logging streamed to CloudWatch Logs / Datadog with 90-day retention.
- [ ] CloudWatch / PagerDuty alarms configured:
  - API HTTP 5xx error rate > 1% over 5 minutes.
  - ALB p95 latency > 800ms over 5 minutes.
  - Aurora DB CPU > 80% or Connection count > 85% of pool.
  - RabbitMQ queue depth > 50 messages for > 15 minutes.
  - Health check endpoint `/health/ready` non-200 status.
- [ ] Automated deployment pipeline configured with zero-downtime rolling update and automated rollback via `scripts/deploy-verify-rollback.sh`.
