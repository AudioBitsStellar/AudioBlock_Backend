# Mainnet cutover checklist and runbook

Ordered steps for moving AudioBlocks from testnet to mainnet. Each step has an owner and must be
signed off before the next starts.

## 1. Go / no-go criteria

| Check | Owner | Go when |
|---|---|---|
| Contract audit findings | Smart-contract lead | No open critical or high findings |
| Penetration test | Security lead | Report received, critical and high items fixed |
| Mainnet config validated | Backend lead | The service boots with the mainnet env and `/health` is green |
| Relayer account funded | Ops | Balance above the agreed minimum |
| Database backup taken | Ops | Restore tested within the last 7 days |
| On-call rota published | Engineering manager | Primary and secondary named for the cutover window |

## 2. Cutover steps

1. Announce the maintenance window and put the API in read-only mode.
2. Take a fresh database backup and record its identifier.
3. Deploy the mainnet contracts (or confirm the IDs) and record each contract ID and wasm hash.
4. Set the mainnet environment variables: contract IDs, RPC URL, network passphrase, relayer key.
   See [environment-variables](../environment-variables.md) and
   [production-environment-checklist](../production-environment-checklist.md).
5. Deploy the backend release and wait for the readiness probe.
6. Smoke test: sign in, read a track, submit one low-value transaction through the relayer.
7. Lift read-only mode and announce completion.

## 3. Rollback plan

Trigger a rollback if the smoke test fails or error rate stays elevated for 15 minutes.

1. Put the API back into read-only mode.
2. Redeploy the previous release and restore the previous (testnet) environment variables.
3. Restore the database backup only if migrations were applied that the old release cannot read.
4. Re-run the smoke test against the restored release and announce the outcome.

See also [disaster-recovery](disaster-recovery.md) and [rollback-drill-record](rollback-drill-record.md).
