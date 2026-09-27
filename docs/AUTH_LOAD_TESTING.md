# Auth Concurrency & Login Spike Load Testing

## Overview

High-traffic events (album drops, artist announcements, exclusive NFT sales) trigger massive login and verification spikes on `/api/v1/auth` endpoints. This document outlines the benchmarking methodology, concurrency characteristics, and performance tuning for AudioBlock's authentication system.

## Benchmarked Endpoints

- `POST /api/v1/auth/login-email`: Password verification and JWT minting.
- `POST /api/v1/auth/login`: Wallet signature cryptographic verification and JWT minting.
- `POST /api/v1/auth/refresh`: Refresh token rotation with DB family checks.
- `POST /api/v1/auth/introspect`: Internal service token validation.

## Running the Spike Load Test

Execute the automated benchmark script:

```bash
# Run with default 50 concurrent VUs and 200 total requests
npx ts-node scripts/load-test-auth-spikes.ts

# Or with custom parameters
LOAD_TEST_CONCURRENCY=100 LOAD_TEST_TOTAL=500 npx ts-node scripts/load-test-auth-spikes.ts
```

## Resilience Architecture

1. **Redis-Backed Rate Limiting**: Excess requests beyond configured bursts receive `429 Too Many Requests`, protecting database connection pools and cryptographic hashing threads (bcrypt).
2. **Connection Pool Management**: Pool limits prevent database exhaustion during concurrent bcrypt worker thread spikes.
3. **Stateless JWT Verification**: Fast-path token introspection reduces DB load for internal service calls.
