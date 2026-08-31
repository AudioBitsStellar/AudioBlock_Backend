# ADR-003: File Storage Strategy

**Date:** 2024-01-01
**Status:** Accepted
**Deciders:** Core team

## Context

AudioBlock stores two categories of binary assets:

1. **Audio files** — large (up to several hundred MB), streamed on demand, must survive indefinitely
2. **Cover art / profile images** — moderate size, served as static assets from CDN

Requirements:

- Audio files should be content-addressed and censorship-resistant to align with the decentralised ethos
- Both categories need reliable, cost-effective storage with reasonable retrieval latency
- The backend must not act as a long-term blob store — files should be offloaded after processing
- Upload flow must support chunked multipart upload to handle large files over slow connections

## Decision

Use **Pinata (IPFS pinning service)** for audio file storage. After the backend merges upload chunks and processes the file (transcode, fingerprint), it pins the audio to IPFS via `PinataService` and stores the resulting CID in the database. Cover art and profile images are uploaded to **AWS S3** (or S3-compatible storage) and served via a CloudFront distribution.

Chunked uploads land in `uploads/temp/`, are merged into `uploads/merged/`, and then pushed to Pinata; the local copies are deleted after a successful pin.

## Consequences

### Positive

- IPFS CIDs are content-addressed — the same file always returns the same CID, preventing silent corruption
- Pinata handles replication and availability; we don't operate storage infrastructure
- S3 + CloudFront is battle-tested for image delivery with global low latency
- Separating audio (Pinata) from images (S3) lets us tune costs and CDN policies independently

### Negative / trade-offs

- IPFS retrieval latency can be high without Pinata's dedicated gateway; we depend on Pinata's SLA
- Chunked upload logic adds complexity (chunk storage, merge step, cleanup) compared to direct streaming
- Pinata API keys are secrets that must be rotated if compromised

### Neutral

- `PinataService` (`src/services/PinataService`) is the single integration point; swapping to NFT.Storage or another pinning service requires only changing that service class

## Alternatives considered

| Option                | Why rejected                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| S3 for audio too      | Centralised; contradicts decentralised ownership model; harder to tie CID to NFT metadata                      |
| Arweave               | Permanent storage is appealing but pay-once model and limited JS SDK maturity ruled it out at time of decision |
| Self-hosted IPFS node | Operational burden too high; availability depends on our uptime                                                |
