# Soroban network backfill

Use a separate database for each Stellar network. The API and indexer check
existing indexed events, cursors, backfill status, and projection counts at
startup. Both historical `stellar-testnet` and short `testnet` labels are
accepted for a testnet deployment, with the equivalent labels for mainnet.

1. Stop writers and snapshot the affected database. Inventory distinct
   network values and compare the records with the original deployment
   configuration and network transaction history.
2. Provision clean databases for testnet and mainnet and run the migrations.
   Reindex each network's trusted ledger range into its own database with
   `npm run cli:reindex -- --contract ID --network NETWORK --from LEDGER --to LEDGER`.
3. Rebuild projections in each database. Verify counts and sampled transaction
   hashes against the matching RPC before pointing services at the databases.
4. Keep ambiguous legacy data in the original snapshot until its source
   network can be verified. A missing label or a historical default is
   insufficient evidence to reassign a record.

The guard checks existing network-tagged read models. Legacy transaction
and application tables still need provenance review and a schema migration
before every on-chain record can be considered covered.
