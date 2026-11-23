# ADR-012: Production and Staging Hosting Architecture

**Date:** 2026-11-23  
**Status:** Accepted  
**Deciders:** Infrastructure Team, Security Team, Core Backend Engineering  
**Related issues:** #961 (OPS-01), #962 (OPS-02), #963 (OPS-03), #964 (OPS-04)  
**Supersedes / Extends:** [ADR-004](004-background-job-processing.md), [ADR-010](010-indexer-architecture.md)

---

## Context

AudioBlocks is transitioning from development and audit phases to pre-launch production hardening (Launch Readiness OPS-01 through OPS-04). The platform consists of multiple workload types with distinct runtime and resource profiles:

1. **API Server (`audioblocks-api`)**: Latency-sensitive Node.js 20 / Express 5 application handling authentication, metadata endpoints, and non-custodial Soroban transaction building and relaying.
2. **Song Processing Worker (`audioblocks-song-worker`)**: High-CPU, bursty worker executing `ffmpeg` HLS audio packaging and Pinata IPFS pinning via RabbitMQ tasks.
3. **Soroban Event Indexer (`audioblocks-indexer`)**: Continuous ledger event poller and projector reading from Stellar RPC and synchronizing on-chain NFT and marketplace activity into PostgreSQL.
4. **Scheduled Operations (`audioblocks-scheduler`)**: Cron-based worker executing daily reconciliation, GDPR purges, and publication jobs.
5. **Backing Infrastructure**: High-availability PostgreSQL (relational storage & projections), Redis 7 (caching, login nonces, rate limits), RabbitMQ (durable message broker), and AWS S3 (audio and HLS segment storage).
6. **Stellar Blockchain Integration**: Non-custodial transaction relay requiring reliable RPC communication with Stellar Testnet (staging) and Stellar Mainnet (production).

Prior to this decision, the repository lacked a formalized hosting architectural decision record, deployment environments were not fully specified, and deployment workflows were absent.

---

## Decision

We select **AWS Elastic Container Service (ECS) with AWS Fargate** for compute workloads, combined with **AWS Managed Backing Services** and **Cloudflare** at the edge, deployed across multiple Availability Zones in `us-east-1`.

### 1. Workload Separation & Compute

Workloads are segregated into independent ECS Services to prevent resource contention:
* **API Service**: Autoscaled from 2 to 10 Fargate tasks (`0.50 vCPU`, `1024MB RAM`), fronted by an Application Load Balancer (ALB).
* **Song Worker Service**: Autoscaled from 2 to 8 Fargate tasks (`1.00 vCPU`, `2048MB RAM`) scaling on RabbitMQ queue depth (`song_upload_tasks`).
* **Indexer Service**: Pinned singleton task (`0.50 vCPU`, `1024MB RAM`) with container auto-recovery for sequential ledger polling.
* **Scheduler Service**: Low-priority background task executing scheduled cron routines.

### 2. Managed Backing Infrastructure

* **Relational Database**: Amazon Aurora PostgreSQL Serverless v2 (PostgreSQL 15), Multi-AZ with automatic failover, read replica for analytical queries, and SSL enforced.
* **In-Memory Cache**: Amazon ElastiCache for Redis 7 (Cluster mode enabled, Multi-AZ with automatic failover, in-transit TLS encryption, authentication enabled).
* **Message Broker**: Amazon MQ for RabbitMQ 3.13 (Active/Standby cluster across two Availability Zones, durable exchanges and queues).
* **Object Storage**: Amazon S3 standard bucket with AES-256 KMS encryption, cross-region replication for backups, and lifecycle rule transitioning `uploads/raw/` after 7 days.
* **Edge & DNS**: Cloudflare Enterprise/Pro for DNS, TLS 1.3 termination, WAF rate limiting, and edge caching of immutable HLS audio fragments (`.ts`).

### 3. Stellar Blockchain Network Topologies

* **Staging Environment**:
  * Network: **Stellar Testnet**
  * RPC Endpoint: `https://soroban-testnet.stellar.org`
  * Passphrase: `Test SDF Network ; September 2015`
  * Horizon: `https://horizon-testnet.stellar.org`
  * Contract Addresses: Testnet Diamond & Facet contracts deployed via automated pipeline.
* **Production Environment**:
  * Network: **Stellar Mainnet (Pubnet)**
  * RPC Endpoint: Enterprise dedicated RPC node via **QuickNode / NowNodes** (primary) with secondary fallback to private `stellar-soroban-rpc` instances. *Note: Stellar Development Foundation does not provide a public free-tier RPC for mainnet.*
  * Passphrase: `Public Global Stellar Network ; September 2015`
  * Horizon: `https://horizon.stellar.org`
  * Contract Addresses: Audited Mainnet Diamond & Facet contract deployments.

### 4. Zero-Downtime Deployment & Health Gating

Deployments adhere to a zero-downtime rolling update strategy:
* Minimum Healthy Percent: `100%`
* Maximum Percent: `200%`
* Traffic is gated by automated health probes checking `/health/live`, `/health/ready` (PostgreSQL, Redis, Pinata reachable), and `/health/worker` (RabbitMQ consumer status) prior to cutting over traffic.
* Automated rollback is initiated immediately if candidate tasks fail readiness probes within the 120-second timeout budget.

---

## Consequences

### Positive
- **Fault Isolation**: CPU-intensive `ffmpeg` transcoding cannot starve HTTP API request handling or degrade listener streaming.
- **Serverless Operations**: Fargate removes EC2 OS patching and cluster scaling overhead.
- **Zero-Downtime & Automated Rollback**: High availability during continuous deployment; failed deployments are automatically quarantined and reverted.
- **Staging / Production Parity**: Staging uses identical container images, topologies, and resource allocations with strict isolation from production data.

### Negative / Trade-offs
- Higher cloud cost compared to monolithic single-instance deployment.
- Requires dedicated private RPC provider subscription for Stellar Mainnet.

---

## Alternatives Considered

| Option | Reason for Rejection |
| :--- | :--- |
| **Self-managed Kubernetes (EKS / k8s on EC2)** | Excessive operational complexity and maintenance burden for a small infrastructure team at pre-launch phase. |
| **PaaS (Render / Railway / Fly.io)** | Lacks native multi-AZ active/standby RabbitMQ clusters, granular VPC peering to managed databases, and enterprise SLAs. |
| **Google Cloud Run** | Long-running background workers with RabbitMQ persistent TCP connections and bursty ffmpeg processing face container timeout limitations on standard serverless HTTP runtimes. |
