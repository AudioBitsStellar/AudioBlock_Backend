# ADR-010: Blockchain Event Indexer Architecture

**Date:** 2026-08-31
**Status:** Accepted
**Deciders:** Core team
**Related Issues:** #255, #256, #257, #258

## Context

AudioBlock needs to track blockchain events from 5 Soroban smart contracts (ArtistFacet, SongFacet, AlbumFacet, MarketplaceFacet, RoyaltyFacet) to maintain an indexed, queryable database of on-chain activity. The requirements are:

1. **Multi-network support**: Index both testnet and mainnet simultaneously
2. **Reliability**: Graceful shutdown without losing cursor position
3. **Observability**: Monitor RPC call volumes and costs
4. **Debugging**: Replay/reindex specific ledger ranges when events are missed

## Decision

Implement a standalone indexer worker (`IndexerWorker`) that:

- Runs as a separate process (`npm run worker:indexer`)
- Polls each contract+network pair in independent async loops
- Uses exponential backoff and rate limiting (inherited from `SorobanService`)
- Stores cursor position per contract+network in `indexer_cursors` table
- Supports graceful shutdown via SIGTERM/SIGINT
- Exposes Prometheus metrics for RPC call counts and latency

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     IndexerWorker                            │
│                                                              │
│  ┌─────
 │  │  SongFacet │  │ AlbumFacet  │  ...    │
│  │  (testnet)  │  │  (testnet) │  │  (testnet)  │         │
│  └──────┬──────┘  └──────┬─────┘  └──────┬──────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          ▼                                  │
│                ┌──────────────────┐                         │
│                │ SorobanRpcClient │                         │
│                └────────┬─────────┘                         │
└─────────────────────────┼──────────────────────────────────┘
                          │
                ┌─────────▼──────────┐
                │  Soroban RPC       │
                │  (mainnet/testnet) │
                └─────────┬──────────┘
                          │
                ┌─────────▼──────────┐
                │  IndexedEvent DB   │
                │  indexer_cursors   │
                └────────────────────┘
```

### Multi-Network Isolation (Issue #255)

Each `(contract, network)` pair runs in its own async poll loop:

```typescript
// Mainnet contracts
pollContractEvents({ contractId: ARTIST_MAINNET, network: 'mainnet' });
pollContractEvents({ contractId: SONG_MAINNET, network: 'mainnet' });
// ...

// Testnet contracts
pollContractEvents({ contractId: ARTIST_TESTNET, network: 'testnet' });
pollContractEvents({ contractId: SONG_TESTNET, network: 'testnet' });
// ...
```

**Failure isolation:** A crash in the testnet poll loop does not affect mainnet indexing. Each loop has independent error handling and cursor management.

### Graceful Shutdown (Issue #258)

The worker listens for `SIGTERM` and `SIGINT`:

```typescript
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, finishing current batches...');
  shutdownRequested = true;
});
```

**Cursor safety:**

1. Poll loop checks `shutdownRequested` flag before fetching next batch
2. If true, finishes processing current batch
3. Updates cursor to `lastProcessedLedger`
4. Exits cleanly

**No partial writes:** Cursor is only advanced after a batch is fully persisted to the database.

### RPC Monitoring (Issue #257)

**Metrics exposed:**

```typescript
soroban_rpc_calls_total{network, method, status}
soroban_rpc_latency_seconds{network, method}
```

**Expected call volume:**

- 5 contracts × 2 networks = 10 poll loops
- Poll interval: 5 seconds (configurable via `INDEXER_POLL_INTERVAL_MS`)
- Calls per hour per contract: ~720 (60 min × 60 sec / 5 sec)
- **Total calls per month:** 10 × 720 × 24 × 30 = **5.2 million calls/month**

**Cost estimate (assuming $0.0001 per call):** ~$520/month for continuous indexing.

**Alert thresholds:**

- Lag > 1000 ledgers: Indexer is falling behind
- Error rate > 0.1/sec: RPC or network issues
- P95 latency > 5 seconds: Provider performance degradation

### Replay/Reindex CLI (Issue #256)

**Command:**

```bash
npm run cli:reindex -- \
  --contract CXXX... \
  --network mainnet \
  --from 1000000 \
  --to 1001000 \
  [--dry-run]
```

**Safety guarantees:**

1. **Does not mutate live cursor:** The CLI fetches events and upserts to `indexed_events` but does NOT update `indexer_cursors.lastProcessedLedger`
2. **Idempotent:** Uses `upsertEvent()` which handles duplicates gracefully
3. **Dry-run mode:** `--dry-run` flag logs what would be written without DB changes

**Use cases:**

- Debug suspected missed events
- Re-import after a malformed event was corrected
- Validate indexer logic against historical data

## Configuration

**Environment variables:**

```bash
# Mainnet contract IDs
ARTIST_FACET_MAINNET_CONTRACT_ID=CXXX...
SONG_FACET_MAINNET_CONTRACT_ID=CYYY...
ALBUM_FACET_MAINNET_CONTRACT_ID=CZZZ...
MARKETPLACE_FACET_MAINNET_CONTRACT_ID=CAAA...
ROYALTY_FACET_MAINNET_CONTRACT_ID=CBBB...

# Testnet contract IDs
ARTIST_FACET_TESTNET_CONTRACT_ID=CDDD...
SONG_FACET_TESTNET_CONTRACT_ID=CEEE...
ALBUM_FACET_TESTNET_CONTRACT_ID=CFFF...
MARKETPLACE_FACET_TESTNET_CONTRACT_ID=CGGG...
ROYALTY_FACET_TESTNET_CONTRACT_ID=CHHH...

# RPC endpoints (if different per network)
SOROBAN_RPC_URL_MAINNET=https://soroban-mainnet.stellar.org
SOROBAN_RPC_URL_TESTNET=https://soroban-testnet.stellar.org

# Indexer configuration
INDEXER_POLL_INTERVAL_MS=5000  # Poll every 5 seconds
INDEXER_BATCH_SIZE=100         # Events per batch
INDEXER_OVERLAP_WINDOW=10      # Reorg protection
```

## Database Schema

**indexer_cursors:**

```sql
CREATE TABLE indexer_cursors (
  id UUID PRIMARY KEY,
  contract_id VARCHAR(100) NOT NULL,
  network VARCHAR(50) NOT NULL,
  last_processed_ledger BIGINT DEFAULT 0,
  events_processed BIGINT DEFAULT 0,
  error_count BIGINT DEFAULT 0,
  last_error TEXT,
  last_error_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(contract_id, network)
);
```

**indexed_events:**

```sql
CREATE TABLE indexed_events (
  id UUID PRIMARY KEY,
  event_id VARCHAR(255) NOT NULL,
  network VARCHAR(50) NOT NULL,
  contract_id VARCHAR(100),
  ledger BIGINT,
  event_type VARCHAR(100),
  event_data JSONB,
  tx_hash VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(event_id, network, contract_id)
);
```

## Consequences

### Positive

- **Multi-network ready:** Both mainnet and testnet indexed independently
- **Resilient:** Failures isolated per contract+network
- **Observable:** RPC metrics exposed for capacity planning
- **Debuggable:** Replay/reindex CLI for troubleshooting
- **Safe:** Graceful shutdown prevents cursor corruption

### Negative / Trade-offs

- **Separate process:** Must be deployed and monitored independently
- **RPC costs:** 5M+ calls/month may incur provider fees
- **Memory footprint:** 10 concurrent poll loops (mitigated by rate limiting)

### Neutral

- Reuses existing `SorobanService` backoff/rate-limiting logic
- Follows `SongProcessorWorker` pattern for consistency

## Alternatives Considered

| Option                     | Why rejected                                                                 |
| -------------------------- | ---------------------------------------------------------------------------- |
| Single-network only        | Testnet indexing needed for staging environment validation                   |
| Integrated into main API   | Long-running poll loops block server process; separate worker is cleaner     |
| Batch reindex via backfill | Backfill is for historical one-time imports; reindex is for debugging ranges |
| No graceful shutdown       | Cursor corruption on deploy is unacceptable                                  |

## Testing Strategy

### Unit Tests

- Mock `SorobanRpcClient.getEvents()` responses
- Verify cursor updates only after batch completion
- Simulate `SIGTERM` and verify shutdown behavior
- Test reindex CLI parameter validation

### Integration Tests

- Deploy to staging with testnet contracts
- Send `SIGTERM` mid-batch, verify resumption from correct ledger
- Run reindex CLI, verify events upserted without cursor mutation
- Monitor Prometheus `/metrics` endpoint for RPC call counts

### Manual Verification

1. Deploy indexer worker to staging
2. Monitor logs for 24h
3. Check Grafana dashboard for metrics
4. Trigger graceful shutdown, verify cursor integrity
5. Run reindex CLI against known ledger range

## Deployment

### Staging Rollout

1. Deploy indexer worker with testnet contracts only
2. Run for 48h, monitor metrics and logs
3. Validate cursor updates and event ingestion
4. Test graceful shutdown (kubectl rollout restart)

### Production Rollout

1. Add mainnet contract IDs to production environment
2. Deploy worker alongside API server
3. Monitor RPC call volume and provider quotas
4. Set up Grafana alerts for lag and error rate
5. Document runbook for manual cursor recovery

## Monitoring & Alerts

**Grafana Dashboard:**

- `indexer_lag_ledgers`: Gauge per contract+network
- `soroban_rpc_calls_total`: Counter by method+status
- `soroban_rpc_latency_seconds`: Histogram

**Alerts:**

```yaml
- alert: IndexerLagHigh
  expr: indexer_lag_ledgers > 1000
  for: 5m
  annotations:
    summary: 'Indexer lagging behind by >1000 ledgers'

- alert: IndexerErrorRateHigh
  expr: rate(indexer_errors_total[5m]) > 0.1
  annotations:
    summary: 'Indexer error rate >0.1/sec'

- alert: SorobanRpcLatencyHigh
  expr: histogram_quantile(0.95, soroban_rpc_latency_seconds) > 5
  annotations:
    summary: 'P95 RPC latency >5 seconds'
```

## References

- [docs/indexer-backfill-runbook.md](../indexer-backfill-runbook.md) - Historical backfill process
- [ADR-002: Blockchain Integration](./002-blockchain-integration.md) - Stellar/Soroban rationale
- [ADR-004: Background Job Processing](./004-background-job-processing.md) - Worker patterns
- Issue #255: Support concurrent indexing of testnet and mainnet
- Issue #256: Add a CLI to replay/reindex a specific ledger range
- Issue #257: Monitor Soroban RPC provider quota and cost
- Issue #258: Graceful shutdown for the indexer worker without losing the cursor

## Future Improvements

- **Horizontal scaling:** Shard contracts across multiple worker instances
- **Event subscriptions:** Use Soroban event streams (when available) instead of polling
- **Automatic reindex:** Detect gaps in `indexed_events` and trigger reindex automatically
- **Circuit breaker:** Pause indexing when RPC provider error rate exceeds threshold
