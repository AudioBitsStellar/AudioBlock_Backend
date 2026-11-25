# ADR-013: Contract Upgrade Procedure and Soroban Event-Schema Versioning

**Date:** 2026-11-23
**Status:** Accepted
**Deciders:** Core team
**Related Issues:** #918, #917, #234, #240, #658

## Context

The contracts the indexer reads (ArtistFacet, SongFacet, AlbumFacet, MarketplaceFacet,
RoyaltyFacet) are upgradeable Soroban deployments. An upgrade keeps the contract id, so
the indexer's cursor stays valid — but it can change the *shape* of an event: rename a
symbol, move a value to a different topic position, or add a new event entirely.

`src/services/Soroban/eventDecoders.ts` maps events by symbol and topic position. Before
this ADR there was no record of which decoder revision produced a row, and an event the
decoder did not recognise was dropped: `decode()` returned `null`, the worker counted it as
`eventsSkipped`, logged a warning, and wrote nothing. Two consequences followed from that
one behaviour:

1. Nothing distinguished a row written by last month's decoder from a row written by
   today's, so a mis-decoded field could not be traced back to the release that wrote it.
2. Soroban RPC `getEvents` history is bounded by the horizon's retention window. An event
   dropped at index time can only be recovered by re-fetching the ledger range, and once
   the range ages out of RPC retention it is unrecoverable from the chain side.

Separately, `docs/indexer-resync-runbook.md` §3 described re-indexing as a manual edit of
environment variables plus `DELETE FROM indexer_cursors`. That procedure works but is
undocumented as policy, and nothing stated what must land in the same release as a contract
upgrade.

## Decision

Treat an event-schema change as a coordinated two-sided release, and make the indexer
version-aware and non-destructive:

1. **Every indexed row carries `payload.schemaVersion`.** `EVENT_SCHEMA_VERSION` in
   `eventDecoders.ts` is the single source of truth and is stamped by `baseDTO()` onto both
   decoded and retained rows. Bumping it is a one-line change made in the same PR as the
   new decoder.
2. **Undecodable events are retained, not discarded.** When a decoder returns `null`, the
   worker writes the row with `eventType = 'undecoded'` and the raw `topic`/`value` in the
   payload, under the same RPC `eventId`. Retention costs no migration because
   `indexed_events.payload` is jsonb and the dedup key `(network, contractId, ledger,
   eventId)` is unchanged.
3. **`eventsSkipped` keeps its meaning.** A retained event is still "not projected onto a
   domain table"; it is counted in `eventsSkipped`, never in `eventsProcessed`, and never
   advances the recorded progress count.
4. **The upgrade procedure is the checklist below**, run in order for every contract
   upgrade that touches events.

### Upgrade procedure

| # | Step | Owner | Gate |
| - | ---- | ----- | ---- |
| 1 | Publish the event diff (added / renamed / re-ordered symbols) in the contract upgrade PR. | Contract team | Reviewer can name every changed symbol. |
| 2 | Land the decoder change; if any *existing* symbol's layout changed, bump `EVENT_SCHEMA_VERSION`. | Backend | `src/__tests__/SorobanEventDecoders.test.ts` green. |
| 3 | Deploy the backend **before** the contract for additive changes; **after** the contract only when the indexer must not see the new events. | Ops | Pod/worker restart confirmed via `/metrics`. |
| 4 | Watch the lag SLO for one poll interval (`monitoring/prometheus-alerts.yml`, group `audioblock-indexer`; see ADR-010 for the worker that emits the gauge). | Ops | `HighIndexerLag` not firing. |
| 5 | Confirm nothing was lost: `SELECT count(*) FROM indexed_events WHERE event_type = 'undecoded' AND ledger > <upgrade_ledger>;` | Backend | Expected `0`. |
| 6 | If step 5 is non-zero: delete the retained rows for that ledger range, add the decoder, then re-project with `npm run cli:reindex -- --contract ID --network testnet\|mainnet --from LEDGER --to LEDGER`. | Backend | Row counts match `schemaVersion` expectations. |

Re-projection is safe to repeat: `cli/reindex.ts` writes through
`IndexedEventService.upsertEvent`, which is idempotent on the RPC `eventId`, so the same
ledger range can be replayed without duplicating rows. The same key is why step 6 deletes
first — a retained row and the decoded row it stands for share one `eventId`, so
`upsertEvent` treats the decoded row as a duplicate and leaves the placeholder in place
until it is removed.

## Consequences

### Positive

- An upgrade no longer silently destroys data; the raw event survives in `indexed_events`
  even after the RPC range is pruned.
- `payload.schemaVersion` makes "which decoder wrote this row" answerable in SQL, so a
  backfill can be scoped by version instead of by guesswork.
- The unknown-event path is testable and tested (worker-level retention, idempotent
  re-write, per-contract isolation).
- `docs/indexer-resync-runbook.md` §3's manual cursor surgery now has a written policy to
  point at.

### Negative / trade-offs

- `indexed_events` grows: an unhandled event family is now rows, not a log line. The growth
  is bounded by the event rate and is what the issue asked for, but it is real.
- `undecoded` rows appear in `OnChainEventCountProjection` output as their own
  `eventType`, so any dashboard reading per-type counts will see a new series after an
  upgrade that outruns the decoders.
- `schemaVersion` lives inside jsonb, not a column. Filtering by version is a jsonb
  predicate; if that becomes hot, add a generated column in a later migration.
- Decoders must be edited in lockstep with contract changes; a missed bump means two
  layouts share one version number.

### Neutral

- `SorobanEventReader.normalizeEvent` now logs (instead of silently returning `null`) when
  an `ScVal` cannot be deserialised, which is the first visible symptom of an incompatible
  upgrade.
- Historical `undecoded` rows written before this change do not exist; nothing needs
  backfilling to adopt the convention.

## Alternatives considered

| Option                                                        | Why rejected                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Drop undecoded events, keep a counter metric only             | Loses the payload permanently once the ledger range leaves RPC retention; re-projection then needs archive access.   |
| Store raw XDR in a separate `dead_letter_events` table        | Needs a migration and a second dedup path; `indexed_events` already has the dedup key and a jsonb payload.            |
| Add a top-level `schema_version` column now                   | Migration + entity change for a field no query needs yet; jsonb keeps the first cut free.                            |
| Version each decoder and select by contract WASM hash         | The RPC does not expose the WASM hash per event, so the indexer cannot resolve the version at write time.            |
| Infer the version from the ledger number of the event         | Ledger→release mapping is external knowledge that drifts; an explicit constant is greppable and reviewable.          |
| Reuse `eventType = 'unknown'` instead of `'undecoded'`        | `'unknown'` reads like a domain event name; `'undecoded'` states the failure and is exported as one constant.        |
