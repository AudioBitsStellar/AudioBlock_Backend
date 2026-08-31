# Indexer Backfill Runbook

## Overview

This runbook describes the one-time historical backfill process for importing pre-indexer contract events into the AudioBlock Backend database. The backfill is designed to be **idempotent** and **resumable** — it can be safely aborted and restarted.

## When to Run

Run the backfill **once per contract** when:

- A contract was deployed before the indexer was implemented
- Historical mints, sales, or registrations need to be imported
- The database was reset and historical data needs restoration

## Safety Mechanisms

### Completion Marker

The backfill writes a completion record to the `backfill_status` table with `completed = true` when finished. Subsequent runs will refuse to execute if this marker exists, preventing accidental double-imports.

### Resume Capability

- Progress is tracked in the `indexer_cursors` table (`lastProcessedLedger`)
- If aborted mid-run, restart the backfill — it will resume from the last checkpoint
- The `eventsImported` counter tracks cumulative progress

## Contracts to Backfill

The AudioBlock platform has 5 Stellar smart contracts:

1. **ArtistFacet** — Artist registration and profile updates
2. **SongFacet** — Song minting and metadata
3. **AlbumFacet** — Album creation
4. **MarketplaceFacet** — Listings and sales
5. **RoyaltyFacet** — Royalty distributions

Each contract + network pair requires its own backfill run.

## Prerequisites

1. **Database access** — Ensure `DATABASE_URL` is configured
2. **RPC access** — Valid Stellar RPC endpoint in `SOROBAN_RPC_URL`
3. **Network config** — Set `STELLAR_NETWORK` (mainnet/testnet)
4. **Ledger range** — Identify contract deployment ledger (start) and current ledger (end)

## Step-by-Step Instructions

### 1. Check Backfill Status

Before starting, verify no backfill has completed:

```bash
npm run cli -- backfill:status --contract <CONTRACT_ID> --network <NETWORK>
```

Expected output (if not run before):

```
No backfill record found for CONTRACT_ID on NETWORK
```

If a completed record exists:

```
Backfillalready completed:
  Contract: CONTRACT_ID
  Network: mainnet
  Events Imported: 12,543
  Completed At: 2026-08-15T14:32:11Z
```

### 2. Determine Ledger Range

Find the contract deployment ledger:

```bash
# Query the first ledger containing the contract
curl -X POST https://soroban-mainnet.stellar.org \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getEvents",
    "params": {
      "startLedger": 1,
      "filters": [{ "contractIds": ["CONTRACT_ID"] }],
      "pagination": { "limit": 1 }
    }
  }'
```

The response contains the `ledger` field — use this as `START_LEDGER`.

For `END_LEDGER`, query the current network ledger:

```bash
curl -X POST https://soroban-mainnet.stellar.org \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "getLatestLedger"}'
```

### 3. Run the Backfill

```bash
npm run cli -- backfill:run \
  --contract <CONTRACT_ID> \
  --network <NETWORK> \
  --start <START_LEDGER> \
  --end <END_LEDGER> \
  --batch-size 100
```

**Parameters:**

- `--contract` — Soroban contract address
- `--network` — `mainnet`, `testnet`, or `futurenet`
- `--start` — First ledger to process (contract deployment ledger)
- `--end` — Last ledger to process (current ledger or earlier cutoff)
- `--batch-size` — Events per batch (default: 100, max: 1000)

**Example:**

```bash
npm run cli -- backfill:run \
  --contract CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM \
  --network mainnet \
  --start 500000 \
  --end 750000 \
  --batch-size 200
```

### 4. Monitor Progress

Watch the logs for progress updates:

```
[INFO] Backfill started: CONTRACT_ID (mainnet) ledgers 500000-750000
[INFO] Batch 1/1250: processed 200 events (ledger 500100)
[INFO] Batch 2/1250: processed 200 events (ledger 500200)
...
[INFO] Backfill complete: 248,542 events imported
```

Check the database:

```sql
SELECT * FROM backfill_status WHERE contract_id = 'CONTRACT_ID';
SELECT * FROM indexer_cursors WHERE contract_id = 'CONTRACT_ID';
```

### 5. Verify Completion

```bash
npm run cli -- backfill:status --contract <CONTRACT_ID> --network <NETWORK>
```

Expected output:

```
Backfill completed:
  Contract: CONTRACT_ID
  Network: mainnet
  Ledger Range: 500000-750000
  Events Imported: 248,542
  Completed At: 2026-08-31T10:15:42Z
```

### 6. Post-Backfill Validation

Run data integrity checks:

```bash
# Verify event counts match expectations
npm run cli -- backfill:validate --contract <CONTRACT_ID> --network <NETWORK>

# Check for gaps in processed ledgers
npm run cli -- backfill:check-gaps --contract <CONTRACT_ID> --network <NETWORK>
```

## Aborting and Resuming

### Safe Abort

Press `Ctrl+C` or send `SIGTERM` to the process. The backfill will:

1. Finish processing the current batch
2. Save progress to `indexer_cursors`
3. Exit gracefully

### Resume

Re-run the same command. The backfill will:

1. Check `indexer_cursors.lastProcessedLedger`
2. Skip already-processed ledgers
3. Continue from the last checkpoint

## Error Handling

### RPC Errors

If the RPC endpoint is unavailable:

```
[ERROR] RPC request failed: Connection timeout
[INFO] Retrying in 5 seconds... (attempt 2/5)
```

The backfill retries with exponential backoff (5s, 10s, 20s, 40s, 80s).

### Data Errors

If an event fails to parse:

```
[ERROR] Failed to process event at ledger 502341: Invalid event format
[INFO] Recorded error, continuing with next batch
```

Errors are logged to `backfill_status.error_message` but don't halt the run.

### Fatal Errors

If the backfill cannot continue:

```
[ERROR] Fatal: Database connection lost
[INFO] Backfill aborted. Safe to restart.
```

Restart the backfill to resume from the last checkpoint.

## Re-Running (Manual Override)

If you need to re-run a completed backfill:

1. **Delete the completion marker:**

   ```sql
   DELETE FROM backfill_status
   WHERE contract_id = 'CONTRACT_ID' AND network = 'mainnet';
   ```

2. **Reset the cursor (optional):**

   ```sql
   UPDATE indexer_cursors
   SET last_processed_ledger = 0, events_processed = 0, error_count = 0
   WHERE contract_id = 'CONTRACT_ID' AND network = 'mainnet';
   ```

3. **Re-run the backfill command**

⚠️ **Warning:** Re-running will create duplicate events unless you also delete existing imported data.

## Performance Tuning

### Batch Size

- **Small batches (50-100):** Safer, easier to resume, slower overall
- **Large batches (500-1000):** Faster, but longer recovery time if aborted

### Parallelization

Run multiple backfills concurrently (different contracts):

```bash
# Terminal 1
npm run cli -- backfill:run --contract ARTIST_CONTRACT --network mainnet ...

# Terminal 2
npm run cli -- backfill:run --contract SONG_CONTRACT --network mainnet ...
```

⚠️ **Do not** run the same contract+network twice simultaneously.

## Troubleshooting

### "Backfill already completed" error

- A completion marker exists in `backfill_status`
- Check the table: `SELECT * FROM backfill_status WHERE contract_id = 'CONTRACT_ID';`
- If re-run is intentional, delete the record manually (see "Re-Running")

### No events found

- Verify the contract ID is correct
- Check the ledger range includes the deployment ledger
- Confirm the RPC endpoint is correct for the network

### Backfill hangs

- Check RPC endpoint health: `curl -X POST $SOROBAN_RPC_URL -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`
- Verify network connectivity
- Check database connection pool: `SELECT * FROM pg_stat_activity;`

### High memory usage

- Reduce `--batch-size` (default 100)
- Increase checkpoint frequency (every 50 batches instead of 100)

## Contract IDs (Reference)

| Contract         | Mainnet ID | Testnet ID |
| ---------------- | ---------- | ---------- |
| ArtistFacet      | `CAAA...`  | `CBBB...`  |
| SongFacet        | `CCCC...`  | `CDDD...`  |
| AlbumFacet       | `CEEE...`  | `CFFF...`  |
| MarketplaceFacet | `CGGG...`  | `CHHH...`  |
| RoyaltyFacet     | `CIII...`  | `CJJJ...`  |

_(Replace with actual deployed contract IDs before use)_

## Next Steps

After backfill completion:

1. Start the indexer worker: `npm run worker:indexer`
2. Verify real-time event processing: `GET /api/admin/indexer/status`
3. Monitor metrics: http://localhost:3001/dashboards (Grafana)
4. Set up alerts for lag > 1000 ledgers or error rate > 0.1/s

## Support

For issues or questions:

- Check logs: `docker logs audioblock_backend --tail 100`
- Query status: `GET /api/admin/indexer/status`
- Review metrics: http://localhost:3001
- Open an issue: https://github.com/AudioBitsStellar/AudioBlock_Backend/issues
