# Staging and Production Parity Audit & Specification (OPS-02)

**Audit & Certification Date:** 2026-11-23  
**Status:** Certified / Passes Parity Checklist  
**Related Issues:** #961 (OPS-01), #962 (OPS-02), #963 (OPS-03), #964 (OPS-04)  
**Infrastructure Lead:** `ops-lead@audioblocks.io`

---

## 1. Baseline and Gap Disposition

All previously identified operational and configuration gaps from baseline audit (Issue #374) are resolved and reconciled as follows:

| Area | Tracked Production Configuration | Staging Evidence & Disposition | Status |
| :--- | :--- | :--- | :--- |
| **Deployment Workflow** | GitHub Actions CD workflow (`.github/workflows/deploy.yml`), tag-triggered deployment to `production` environment with required reviewers. | GitHub Actions CD workflow deploys automatically to `staging` environment on every merge to `main`. `docker-compose.staging.yml` mirrors `docker-compose.prod.yml`. | **RESOLVED** |
| **Runtime & Base Images** | Multi-stage Dockerfile (`node:20-alpine`, `ffmpeg`, non-root user `appuser`). | Identical Docker image artifact built once in CI, digest-pinned, and promoted across environments. | **RESOLVED** |
| **Reproducible Install** | `npm ci` with verified `package-lock.json` dependency integrity and Node 20 LTS runtime. | Same locked dependencies and build process enforced by CI build gate. | **RESOLVED** |
| **Build Gate** | Strict `tsc` compilation and linter passing in CI. | Automated CI pipeline gate blocks PRs and merges if build or static checks fail. | **RESOLVED** |
| **Environment Contract** | Validated via `scripts/check-env-example.js --strict`. Production secrets in AWS Secrets Manager. | Staging secrets isolated in AWS Secrets Manager; full key set validated against `.env.example`. | **RESOLVED** |
| **Resource Sizing** | Backend: `0.50 vCPU`, `512MB RAM` (API); Worker: `1.00 vCPU`, `1024MB RAM`; DB: `0.50 vCPU`, `512MB RAM`; Redis & RabbitMQ: `0.25 vCPU`, `256MB RAM`. | Identical container limits enforced in `docker-compose.staging.yml` and staging ECS task definitions. | **RESOLVED** |
| **Blockchain Network** | Stellar Mainnet (`Public Global Stellar Network ; September 2015`) via dedicated enterprise RPC. | Stellar Testnet (`Test SDF Network ; September 2015`) via `https://soroban-testnet.stellar.org`. Complete protocol parity. | **RESOLVED** |
| **Data & Services Isolation** | Production PostgreSQL, Redis, RabbitMQ cluster, S3 bucket (`audioblocks-prod-media`), Pinata JWT. | Fully isolated Staging PostgreSQL, Redis, RabbitMQ, S3 bucket (`audioblocks-staging-media`), Pinata staging keys. Zero shared credentials. | **RESOLVED** |
| **Storage & Persistence** | Encrypted S3 bucket with 7-day lifecycle on `uploads/raw/`. Persistent EBS/EFS volumes. | Staging S3 bucket with identical CORS, encryption, and lifecycle rules. | **RESOLVED** |
| **Networking & Security** | Private VPC subnets, ALB TLS 1.3, strict CORS (`ALLOWED_ORIGINS` without wildcards). | Private VPC subnets, ALB TLS 1.3, staging-specific explicit CORS allowlist. | **RESOLVED** |
| **Worker Topology** | Standalone `SongProcessorWorker` and `IndexerWorker` containers with bounded prefetch (`WORKER_PREFETCH=1`). | Identical consumer count, concurrency, and supervisor configuration. | **RESOLVED** |
| **Observability** | Prometheus metrics scraping, Pino structured logs, `/health/ready` deep dependency probes. | Identical Prometheus and logging pipeline enabled for staging. | **RESOLVED** |

---

## 2. Operator Parity Checklist

The operator parity checklist verifies that Staging mirrors Production in topology, runtime invariants, and failure recovery while maintaining complete cryptographic and data isolation:

- [x] **Artifact Immutability**: The same immutable container image (`ghcr.io/audioblock/audioblock-backend:sha-<commit>`) is deployed to staging and subsequently promoted to production.
- [x] **Configuration Parity**: Both environments run with `NODE_ENV=production`. This ensures that TypeORM automatic schema synchronization is disabled across both environments and all schema updates occur via versioned migrations (`npm run migration:run`).
- [x] **Service Topology**: Compose overlays (`docker-compose.prod.yml` and `docker-compose.staging.yml`) declare matching service dependencies, resource ceilings, and healthchecks verified by `scripts/check-compose-consistency.js`.
- [x] **Strict Data Isolation**:
  - Separate database instances (Staging DB vs Production DB).
  - Separate Redis cache instances (Staging vs Production).
  - Separate RabbitMQ message brokers and vhosts.
  - Separate AWS S3 storage buckets (`audioblocks-staging-media` vs `audioblocks-prod-media`).
  - Separate Stellar blockchain keypairs and networks (Testnet vs Mainnet).
- [x] **Blockchain Network Configuration**:
  - **Staging**:
    - `SOROBAN_NETWORK=testnet`
    - `SOROBAN_RPC_URL=https://soroban-testnet.stellar.org`
    - `SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"`
    - Testnet Diamond/Facet Contract Addresses.
  - **Production**:
    - `SOROBAN_NETWORK=mainnet`
    - `SOROBAN_RPC_URL=<Dedicated Provider RPC URL>`
    - `SOROBAN_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"`
    - Audited Mainnet Diamond/Facet Contract Addresses.
- [x] **End-to-End Pipeline Validation**:
  - User registration and authentication (JWT & Privy).
  - Audio chunk upload, ffmpeg HLS transcoding, and IPFS metadata pinning.
  - HLS audio playback and manifest generation via presigned URLs.
  - Non-custodial Soroban transaction simulation, signing, and submission relay.
  - Soroban indexer event polling and PostgreSQL projection.
- [x] **Zero-Downtime Rollout & Health Checks**:
  - Health checks `/health/live`, `/health/ready`, and `/health/worker` gate traffic before cutover.
  - Automated rollback verified using `scripts/deploy-verify-rollback.sh`.

---

## 3. Approved Environmental Differences

The only differences permitted between staging and production are environment-scoped network coordinates and capacity scaling factors:

| Setting | Staging Value | Production Value | Justification |
| :--- | :--- | :--- | :--- |
| `SOROBAN_NETWORK` | `testnet` | `mainnet` | Testing against Stellar testnet without financial consequence. |
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | Dedicated Private RPC (e.g. QuickNode) | Testnet uses SDF endpoint; Mainnet requires dedicated high-throughput RPC. |
| `SOROBAN_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` | Network-level cryptographic boundary. |
| `ALLOWED_ORIGINS` | `https://staging.audioblocks.io` | `https://audioblocks.io,https://artist.audioblocks.io` | Environment-specific frontend URLs. |
| Database / S3 / Cache | Dedicated staging resources | Dedicated production resources | Hard multi-tenant boundary preventing cross-contamination. |
| Replicas (Min/Max) | 2 min / 4 max | 2 min / 10 max | Lower baseline traffic in staging while preserving multi-AZ topology. |

---

## 4. Certification & Sign-off

* **Platform Lead:** Verified and approved (`ops-lead@audioblocks.io`) — 2026-11-23  
* **Security Lead:** Verified credential and VPC boundary isolation — 2026-11-23  
* **Verification Command:** `npm run env:check:strict && npm run compose:check`
