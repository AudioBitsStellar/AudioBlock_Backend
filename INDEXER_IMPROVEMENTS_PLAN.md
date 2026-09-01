# Indexer Improvements Implementation Plan

## Overview

This document outlines the implementation plan for issues #255, #256, #257, and #258, which collectively enhance the AudioBlock indexer subsystem with multi-network support, observability, graceful shutdown, and debugging capabilities.

**Related Issues:**

- Closes #255 - Support concurrent indexing of testnet and mainnet
- Closes #256 - Add a CLI to replay/reindex a specific ledger range
- Closes #257 - Monitor Soroban RPC provider quota and cost
- Closes #258 - Graceful shutdown for the indexer worker without losing the cursor

## Current State Analysis

### Existing Infrastructure

The codebase currently has:

1. **IndexerService** (`src/services/IndexerService.ts`): Manages cursor positions, backfill status, and metrics
2. **IndexerCursor** entity: Tracks last-processed ledger per contract+network
3. **IndexedEvent** entity: Stores on-chain events
4. **BackfillStatus** entity: Tracks historical backfill completion
5. **SorobanService**: Handles RPC calls with exponential backoff and rate limiting
6. **Backfill runbook** (`docs/indexer-back
   e

- **Replay/reindex CLI**: No tooling for bounded historical re-processing

## Implementation Strategy

### Phase 1: Core Indexer Worker (#255, #258)

#### 1.1 Create IndexerWorker

**File:** `src/workers/IndexerWorker.ts`

**Responsibilities:**

- Poll Soroban RPC for events from 5 contracts (ArtistFacet, SongFacet, AlbumFacet, MarketplaceFacet, RoyaltyFacet)
- Support concurrent mainnet + testnet operation
- Handle graceful shutdown (SIGTERM/SIGINT)
- Persist cursor position after each batch
- Integrate with existing `IndexerService` and `IndexedEventService`

**Architecture:**

```typescript
class IndexerWorker {
  // One poll loop per (contract, network) pair
  async pollContractEvents(contractId: string, network: string): Promise<void>;

  // Graceful shutdown
  private setupShutdownHandlers(): void;
  private async shutdown(): void;

  // Main entry point - spawns all poll loops
  async start(): Promise<void>;
}
```

**Configuration:**

- Environment variables for each contract (ArtistFacet, SongFacet, etc.) on both networks
- Example:
  ```
  ARTIST_FACET_MAINNET_CONTRACT_ID=CXXX...
  ARTIST_FACET_TESTNET_CONTRACT_ID=CYYY...
  SONG_FACET_MAINNET_CONTRACT_ID=CZZZ...
  ...
  ```

**Network Isolation:**

- Each (contract, network) runs in its own async loop
- Failures in one loop don't affect others
- Separate IndexerCursor records per contract+network

#### 1.2 Graceful Shutdown (#258)

**Requirements:**

- Listen for SIGTERM and SIGINT signals
- Stop accepting new batches
- Finish in-flight batch processing
- Persist cursor position
- Exit cleanly without orphaned writes

**Implementation pattern** (mirroring SongProcessorWorker if present):

```typescript
let shutdownRequested = false;

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, finishing current batch...');
  shutdownRequested = true;
});

// In poll loop:
while (!shutdownRequested) {
  // Process batch
  // Persist cursor
}
```

### Phase 2: RPC Monitoring (#257)

#### 2.1 RPC Call Metrics

**File:** `src/services/MetricsService.ts` (extend existing)

Add Prometheus metrics:

```typescript
// Call counts by network and endpoint
export const sorobanRpcCallsTotal = new Counter({
  name: 'soroban_rpc_calls_total',
  help: 'Total number of Soroban RPC calls',
  labelNames: ['network', 'method', 'status'],
});

// Call latency
export const sorobanRpcLatencySeconds = new Histogram({
  name: 'soroban_rpc_latency_seconds',
  help: 'Soroban RPC call latency in seconds',
  labelNames: ['network', 'method'],
});
```

**Instrumentation:**

- Update `SorobanService.withBackoff()` to record metrics
- Track: `getEvents`, `getTransaction`, `sendTransaction`, `prepareTransaction`
- Record: success/failure, latency, network

#### 2.2 Cost/Quota Documentation

**File:** `docs/adrs/010-indexer-architecture.md` (new ADR)

Document:

- Expected RPC call volume (5 contracts × 2 networks × poll frequency)
- Monthly estimates (e.g., 1 call per 5 seconds per contract = ~5.2M calls/month)
- Provider quota thresholds (if known)
- Alert thresholds (e.g., >100 calls/min, >5s latency P95)
- Cost projections based on provider pricing

#### 2.3 Admin Endpoint

**File:** `src/controllers/AdminController.ts` (extend existing)

Add endpoint:

```
GET /api/admin/indexer/rpc-metrics
```

Returns:

```json
{
  "mainnet": {
    "callsLast24h": 125000,
    "avgLatencyMs": 150,
    "errorRate": 0.001
  },
  "testnet": { ... }
}
```

### Phase 3: Replay/Reindex CLI (#256)

#### 3.1 CLI Command

**File:** `src/cli/reindex.ts` (new)

**Interface:**

```bash
npm run cli -- reindex \
  --contract <CONTRACT_ID> \
  --network <mainnet|testnet> \
  --from <START_LEDGER> \
  --to <END_LEDGER> \
  [--dry-run]
```

**Safety guarantees:**

- **Does not** mutate the live `indexer_cursors.lastProcessedLedger`
- **Does** write/update `indexed_events` rows idempotently (upsert by eventId+network+contractId)
- Creates a temporary cursor record or uses a separate `reindex_cursors` table

#### 3.2 Implementation

```typescript
export async function reindexRange(opts: {
  contractId: string;
  network: string;
  fromLedger: number;
  toLedger: number;
  dryRun?: boolean;
}): Promise<void> {
  // Fetch events in range using SorobanService.getEvents()
  // Process each event through existing IndexedEventService.upsertEvent()
  // Log progress
  // Do NOT update production cursor
}
```

**Usage example in docs:**

```bash
# Reindex a specific range after a suspected missed event
npm run cli -- reindex \
  --contract CXXX... \
  --network mainnet \
  --from 1000000 \
  --to 1001000

# Dry-run mode (read-only, no DB writes)
npm run cli -- reindex \
  --contract CXXX... \
  --network mainnet \
  --from 1000000 \
  --to 1001000 \
  --dry-run
```

### Phase 4: Documentation & Testing

#### 4.1 ADR Update

**File:** `docs/adrs/010-indexer-architecture.md` (new)

Contents:

- Architecture diagram (poll loops, cursor management, graceful shutdown)
- Multi-network design rationale
- RPC call budget and monitoring strategy
- Recovery procedures (replay/reindex)
- References to existing backfill runbook

#### 4.2 Package.json Scripts

Add:

```json
{
  "scripts": {
    "worker:indexer": "ts-node src/workers/IndexerWorker.ts",
    "cli:reindex": "ts-node src/cli/reindex.ts"
  }
}
```

#### 4.3 Tests

**Files to create:**

- `src/__tests__/IndexerWorker.test.ts`: Mock RPC, verify cursor updates, shutdown handling
- `src/__tests__/ReindexCLI.test.ts`: Test range validation, dry-run mode, idempotency

**Scenarios:**

- Multi-network isolation (failure in testnet doesn't stop mainnet)
- Graceful shutdown mid-batch (cursor not advanced until batch completes)
- Replay/reindex doesn't mutate live cursor
- RPC metrics recorded correctly

## File Changes Summary

### New Files

1. `src/workers/IndexerWorker.ts` - Core indexer worker
2. `src/cli/reindex.ts` - Replay/reindex CLI tool
3. `docs/adrs/010-indexer-architecture.md` - Indexer architecture ADR
4. `src/__tests__/IndexerWorker.test.ts` - Worker tests
5. `src/__tests__/ReindexCLI.test.ts` - CLI tests

### Modified Files

1. `src/services/MetricsService.ts` - Add RPC call metrics
2. `src/services/Soroban/SorobanService.ts` - Instrument withBackoff() for metrics
3. `src/controllers/AdminController.ts` - Add RPC metrics endpoint
4. `src/index.ts` - Register indexer worker startup (optional, or separate process)
5. `package.json` - Add worker:indexer and cli:reindex scripts
6. `.env.example` - Document new environment variables for contract IDs
7. `src/config/env.ts` - Validate new environment variables

## Environment Variables

New variables required:

```bash
# Mainnet contract IDs
ARTIST_FACET_MAINNET_CONTRACT_ID=
SONG_FACET_MAINNET_CONTRACT_ID=
ALBUM_FACET_MAINNET_CONTRACT_ID=
MARKETPLACE_FACET_MAINNET_CONTRACT_ID=
ROYALTY_FACET_MAINNET_CONTRACT_ID=

# Testnet contract IDs
ARTIST_FACET_TESTNET_CONTRACT_ID=
SONG_FACET_TESTNET_CONTRACT_ID=
ALBUM_FACET_TESTNET_CONTRACT_ID=
MARKETPLACE_FACET_TESTNET_CONTRACT_ID=
ROYALTY_FACET_TESTNET_CONTRACT_ID=

# RPC endpoints (if different per network)
SOROBAN_RPC_URL_MAINNET=https://soroban-mainnet.stellar.org
SOROBAN_RPC_URL_TESTNET=https://soroban-testnet.stellar.org

# Indexer configuration
INDEXER_POLL_INTERVAL_MS=5000  # Poll every 5 seconds
INDEXER_BATCH_SIZE=100         # Events per batch
INDEXER_OVERLAP_WINDOW=10      # Reorg protection (existing)
```

## Acceptance Criteria Checklist

### Issue #255: Multi-network indexing

- [ ] Both networks index independently
- [ ] A failure on one network does not affect the other
- [ ] Documented in the indexer ADR

### Issue #256: Replay/reindex CLI

- [ ] Does not mutate the live cursor
- [ ] Writes/updates IndexedEvent rows idempotently
- [ ] Documented with an example invocation

### Issue #257: RPC monitoring

- [ ] RPC call count metric exposed
- [ ] Expected monthly volume estimated in docs
- [ ] Alert threshold proposed

### Issue #258: Graceful shutdown

- [ ] Cursor is only advanced after a batch is fully persisted
- [ ] Verified with a manual kill test
- [ ] No orphaned partial writes

## Testing Strategy

### Unit Tests

- Mock SorobanService.getEvents() responses
- Verify cursor updates after batch completion
- Test shutdown signal handling (simulate SIGTERM)
- Validate reindex CLI parameter validation

### Integration Tests

- Run indexer against testnet with 2 contracts
- Kill process mid-batch, verify resumption from last cursor
- Run reindex CLI, verify events upserted without cursor mutation
- Monitor Prometheus /metrics endpoint for RPC call counts

### Manual Verification

1. Deploy to staging with testnet+mainnet configured
2. Monitor logs for concurrent poll loops
3. Send SIGTERM, verify clean shutdown
4. Check Grafana dashboard for RPC metrics
5. Run reindex CLI against known ledger range, verify results

## Rollout Plan

### Stage 1: Development

- Implement IndexerWorker with graceful shutdown (#255, #258)
- Add RPC metrics to SorobanService (#257)
- Write unit tests

### Stage 2: CLI Tool

- Implement reindex CLI (#256)
- Test against testnet
- Document usage

### Stage 3: Documentation

- Write ADR 010
- Update .env.example
- Update deployment docs

### Stage 4: Deployment

- Deploy to staging, run for 48h
- Monitor metrics and logs
- Gradually enable mainnet contracts
- Full production rollout

## Risk Mitigation

### Risk: RPC rate limiting

**Mitigation:** Existing backoff logic in SorobanService, tunable poll intervals

### Risk: Database connection exhaustion

**Mitigation:** Use connection pooling (already configured), batch writes

### Risk: Cursor corruption on crash

**Mitigation:** Transactional cursor updates (wrap in DB transaction), only advance after batch persists

### Risk: Reindex CLI mutates production cursor

**Mitigation:** Explicit safety check in code, separate cursor record or read-only mode

### Risk: Memory leak in long-running indexer

**Mitigation:** Monitor process memory, add heap snapshots, test 72h continuous run

## Success Metrics

After deployment, measure:

1. **Uptime:** Indexer runs for >7 days without restart
2. **Lag:** <100 ledgers behind current network head 95% of time
3. **RPC metrics:** Visible in Grafana, no quota exceeded alerts
4. **Multi-network:** Both networks indexed with independent cursors
5. **Graceful shutdown:** Zero cursor corruption incidents on deploy/restart
6. **Reindex usage:** Successfully resolve ≥1 missed event investigation

## Timeline Estimate

- **IndexerWorker + graceful shutdown:** 3-4 days
- **RPC monitoring + metrics:** 1-2 days
- **Reindex CLI:** 2-3 days
- **Documentation + ADR:** 1 day
- **Testing + deployment:** 2-3 days

**Total:** 9-13 days for full implementation and production rollout

## Questions for Review

1. Should indexer run as separate process (npm run worker:indexer) or integrated into main server?
2. What are the actual contract IDs for mainnet/testnet?
3. Any known RPC provider quotas or rate limits to document?
4. Should reindex CLI support parallel processing (multiple contracts at once)?
5. Grafana dashboard updates needed for new RPC metrics?

## Next Steps

After approval of this plan:

1. Create feature branch `indexer-improvements`
2. Implement in order: #258 → #255 → #257 → #256
3. Open PR with all changes + tests
4. Deploy to staging for validation
5. Production rollout with monitoring
