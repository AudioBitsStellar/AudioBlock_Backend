# Support User Lookup

Covers the read-only part of #983, "Support tooling: user lookup and safe impersonation with audit".
Impersonation is **not** part of this change. See [Impersonation](#impersonation-not-implemented).

## Endpoint

```
GET /api/admin/users/lookup?query=<exact identifier>
```

Requires the `user:manage` permission (admin and super_admin). Moderators do not have it.

`query` is matched exactly, against any of:

- the account `email`
- the `username`
- the `walletAddress`
- the `stellarPublicKey`
- the `privyUserId`
- the account `id`, when the value is a UUID

Partial and fuzzy matching are not supported. The endpoint cannot be used to list or enumerate
accounts.

| Response        | Meaning                                                           |
| --------------- | ----------------------------------------------------------------- |
| `200` `data`    | The support view below.                                           |
| `400`           | `query` is empty after trimming, or longer than 255 characters.   |
| `404`           | No account matches. The lookup is still audited.                  |

## What the support view contains

| Field                                                  | Notes                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `id`, `username`, `email`, `role`                      |                                                            |
| `emailVerified`, `twoFactorEnabled`, `isVerified`      | Booleans only. The 2FA secret and recovery codes are not returned. |
| `walletAddress`, `stellarPublicKey`                    |                                                            |
| `privyLinked`                                          | Boolean. The Privy user id is not returned.                |
| `payoutHold` (`active`, `reason`, `placedAt`)          | See [SANCTIONS_SCREENING.md](./SANCTIONS_SCREENING.md).     |
| `deletionRequestedAt`, `deletionScheduledFor`, `deletedAt` | Shows where the account is in the erasure lifecycle.   |
| `createdAt`, `updatedAt`                               |                                                            |

The view is an allowlist. The query reads only the columns it needs from the database
(`SUPPORT_SELECT` in `src/services/Support/SupportUserService.ts`). The password hash, 2FA secret,
recovery-code hashes, password-reset and email-verification tokens, and Privy identifiers are never
selected.

## Audit

Every lookup writes a `transactions_logs` row before the response is sent:

- `action`: `SUPPORT_USER_LOOKUP`
- `user_id`: the admin who ran the lookup
- `description`: `target=<account id>`, or `target=none` when nothing matched

The query text is **not** stored. It can be an email address, so storing it would copy personal data
into the log. If the audit write fails, the lookup fails and no data is returned.

This differs from the general rule in [data-lifecycle-and-audit-log.md](./data-lifecycle-and-audit-log.md),
which does not log read-only actions. Issue #983 requires lookups to be logged.

### Known side effect

`transactions_logs` is keyed by the acting user, and the wallet history endpoint reads it by user.
An admin's own wallet history will therefore list their `SUPPORT_USER_LOOKUP` rows. Filtering those
out of wallet history is a follow-up in `TransactionLogService.getWalletHistory`. It is not part of
this change.

## Impersonation (not implemented)

Acting as another user needs its own design before any code is written. The design must cover:

- explicit consent or a documented legal basis for each session
- a session that is visibly marked as impersonation to both the admin and the affected user
- a time limit, and a way to end it early
- write restrictions: a read-only mode first, then specific, audited writes
- audit entries for every request made during the session, not only the start

Until that exists, support staff have read-only visibility through this endpoint.
