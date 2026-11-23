# Sanctions Screening and Payout Holds

Covers #985, "Sanctions/AML screening before payouts". Read this before you wire a payout
flow to the backend, or before you choose a screening vendor.

## What is gated

`RoyaltyPayoutService.recordExpectedPayout()` is the backend's payout gate. It calls
`SanctionsScreeningService.assertRecipientsCleared()` for every split recipient before anything
is written to `royalty_payouts`.

A recipient is blocked when either of these is true:

1. Its account has a **payout hold** (`users.payoutHoldReason` is set).
2. The screening provider reports a **match** for its Stellar public key. The account is then
   placed on hold automatically, with reason `sanctions_match`.

If the provider cannot answer, the payout is blocked as well (fail closed). An unavailable screen
never counts as "clear".

Blocked calls throw `AppError` with code `PAYOUT_BLOCKED` (403), or `SCREENING_UNAVAILABLE` (502).
Nothing is persisted in either case.

## What is not gated

The backend cannot stop an on-chain transfer. The royalty and marketplace contracts
(`SorobanContracts.royalty`, `SorobanContracts.catalog`) settle sales on their own. A payout that
happens on-chain never passes through `recordExpectedPayout()`. Screening for on-chain settlement
has to run before a transaction is submitted to the network, and that is a separate change.

There are currently no callers of `recordExpectedPayout()` in the codebase. The gate is in place
for the flow that will call it. The caller must treat `PAYOUT_BLOCKED` as "hold this payout and
alert compliance". It must not retry the call.

## Configuration

| Variable                       | Default    | Meaning                                                                 |
| ------------------------------ | ---------- | ----------------------------------------------------------------------- |
| `SANCTIONS_SCREENING_PROVIDER` | `denylist` | Only `denylist` is built in. Any other value blocks payouts.            |
| `SANCTIONS_DENYLIST`           | empty      | Comma-separated Stellar public keys (`G...`) that payouts must not reach. |

The provider is built on first use, not at boot. A bad value therefore fails payouts, but it does
not stop the server from starting.

### Provider status

The repository ships only the **local denylist** provider. It is a stopgap. It matches exact
public keys and nothing else: no name matching, no list updates, no audit against an external
list. A licensed screening vendor has not been chosen. Adding one means implementing
`SanctionsScreeningProvider` in `src/services/Compliance/sanctionsProviders.ts` and adding a
case to `createScreeningProviderFromEnv`. The payout gate does not need to change.

## Admin: holds

Admins with `user:manage` (admin and super_admin) place or clear a hold with:

```
PUT /api/admin/users/:id/payout-hold
Content-Type: application/json

{ "hold": true, "reason": "Court order 42" }
```

`reason` is optional, up to 500 characters. If it is omitted, the hold is recorded as
`manual_hold`. Clearing a hold is `{ "hold": false }`.

The response contains the account's hold state. It contains no other account data.

## Audit trail

Every hold change writes a `transactions_logs` row:

| Action                | `user_id` (actor)                                         | `description`                              |
| --------------------- | --------------------------------------------------------- | ------------------------------------------ |
| `PAYOUT_HOLD_PLACED`  | the admin for a manual hold; the **held account** for an automatic `sanctions_match` hold | `target=<id> reason=<text>` or `automatic: sanctions_match (<ref>)` |
| `PAYOUT_HOLD_CLEARED` | the admin who cleared it                                  | `target=<id> reason=<text>`                |

`user_id` holds the account that acted. For automatic holds that account is the affected one, so
the row also appears in that user's own transaction history.

## Schema

Migration `1758200000000-AddUserPayoutHold` adds two nullable columns to `users`:
`payoutHoldReason` (varchar) and `payoutHoldPlacedAt` (timestamp). Accounts without a hold are
unaffected.

## Known gaps

- No licensed screening vendor. The denylist covers exact public-key matches only.
- Pending payouts recorded before a hold is placed are not re-screened. Reconciliation does not
  look at holds.
- On-chain settlement is not screened (see above).
- Recipients without a local account can be blocked for a request, but no hold can be stored
  for them.
