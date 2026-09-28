# GDPR Account Deletion & Data Portability (#633)

The user-facing right-to-erasure and data-portability flow. Applies to both the
legacy auth path and Privy. See also [PRIVY_AUTH.md](PRIVY_AUTH.md) for the
authentication side of the migration.

## Endpoints

All routes are `requireAuth` + a tight per-user rate limiter
(`ACCOUNT_LIFECYCLE_RATE_LIMIT_MAX`, default 5/hour). There is deliberately **no
`/:userId` variant** — the subject of every request is the bearer, so the surface
cannot be aimed at another account.

| Method   | Path                          | Article | Purpose                                  |
| -------- | ----------------------------- | ------- | ---------------------------------------- |
| `GET`    | `/api/account/data`           | 15, 20  | Full copy of the caller's personal data  |
| `POST`   | `/api/account/deletion-request` | 17    | Schedule erasure (requires `confirm: true`) |
| `DELETE` | `/api/account/deletion-request` | 17    | Cancel within the grace window           |
| `GET`    | `/api/account/deletion-status` | 12     | Where the request stands                 |

The scheduled erasure runs separately:

```bash
npm run gdpr:purge-accounts              # all due accounts
npm run gdpr:purge-accounts -- --limit=50
```

Run it on a schedule. It is a standalone script rather than an in-process timer
because the erasure is irreversible: it should be something an operator can
trigger, observe, and re-run.

## Why the user row is anonymised, not deleted

The obvious implementation — `DELETE FROM users WHERE id = $1` — is wrong here.

`users` is the parent of the platform's financial and on-chain records:

- `royalty_payouts.artist_id` is deliberately `ON DELETE SET NULL`.
- An artist's songs are minted as **on-chain NFTs owned by third parties**.
  Deleting the database row would orphan a real, transferable asset and break
  every existing holder's client.
- `transaction_logs` is the audit trail of what happened to the account.

GDPR anticipates exactly this. **Art. 17(3)(b)** exempts data that must be retained
for a legal obligation, and **17(3)(e)** data retained for contract performance.
The money has already moved on-chain; the record of who was owed what has to
survive.

So the user row is kept as a **tombstone**: every identifying field is nulled and
`deletedAt` is set. That erases the personal data (Art. 17(1)) while leaving the
retained records permanently unattributable. Anonymous row, retained aggregates,
no person.

## What is deleted vs. retained

**Deleted outright** — data whose only purpose was to serve that person, with no
residual value to anyone else:

`refresh_tokens`, `api_keys`, `webhook_subscriptions`, `notifications`,
`song_saves`, `user_saves`, `user_follows` (both directions), `playlist_follows`,
`playlist_collaborators`, `ai_generation_records`, `tweet_drafts`, `activity_feeds`,
`fan_perks`, `subscriptions`, `gift_subscriptions` (both directions),
`song_play_events`, `song_collaborators`, `artist_verifications`.

`api_keys` is the sharpest case: leaving a live API key behind after "delete my
account" would be a security defect, not just a privacy one.

**Retained, but made unattributable by the anonymisation** — `songs`, `albums`,
`releases`, `comments`, `playlists`, `royalty_payouts`, `transaction_logs`.

Published content others interact with (comments, playlists) is retained rather
than removed: deleting a message mid-conversation is more harmful to other users
than making it unattributable, and the tombstone achieves exactly that.

Also invalidated: the artist's cached profile and any cached song streaming
manifests that still carry the former owner's attribution.

## Grace period

`ACCOUNT_DELETION_GRACE_PERIOD_DAYS`, default 30.

Art. 12(3) requires confirmation, and an irreversible step should not be one click
on a shared device. During the window the user can export their data or cancel.

Live sessions are revoked **immediately** on request rather than at the end of the
window — the user has said they want to leave, and leaving refresh tokens valid for
30 days would mean a leaked token stays useful long afterwards.

A request is idempotent: a second call returns the existing request rather than
resetting the clock, so a retrying client cannot accidentally postpone an erasure.

## Audit trail

`account_deletion_requests` — an append-only record (Art. 5(2) accountability,
Art. 30). A flag on the user row cannot demonstrate compliance: if the row is
purged or the database restored from a stale backup, the evidence of what was
erased and when is gone.

The table holds only non-identifying references — the user id and an opaque
`referenceId` the user can quote to support. It deliberately does **not** store the
email, name, or IP that triggered the request, because it outlives the erasure and
is the one place a leak would be durable.

## Privy

If the account was linked to a Privy identity, the upstream identity is deleted via
`DELETE /v1/users/{did}` (Privy soft-deletes embedded wallets by disassociating and
archiving rather than destroying key material, so wallet assets are not at risk).

This is **best-effort by design**. A failed upstream call must not strand a
data-subject request, so a failure is recorded in the audit row
(`privyDeletionStatus = 'failed'`) for follow-up and the local erasure still
completes. A 404 is treated as success — already-absent is the desired end state.

## Interaction with authentication

A tombstoned or pending-deletion account cannot authenticate:

- `PrivyUserResolver` refuses both, so a not-yet-expired Privy token does not keep
  working after an erasure.
- The legacy JWT path carries claims in the token, so a token issued before the
  request remains valid until it expires (15 min). Sessions are revoked
  immediately; this is the residual window.

## Metrics / observability

There are no dedicated erasure metrics yet. The job logs
`{ processed, succeeded, failed }`, and a `failed` account is marked in the audit
row and retried on the next pass. Adding a counter would be worth doing.

---

## Prior review of AI data (#301)

Carried over from the earlier GDPR/AI review. Unchanged by this work except where
noted.

| Data store                    | Erasure method                   | Status                             |
| ----------------------------- | -------------------------------- | ---------------------------------- |
| `ai_preferences`              | CASCADE DELETE on user           | ✅ Implemented                     |
| `user_interactions`           | Explicit DELETE on user deletion | ✅ Now covered — `song_play_events` and the save tables are in the purge list |
| Redis recommendation cache    | TTL-based expiry                 | ✅ Working                         |
| `song_analytics` (aggregated) | Cannot erase (Art. 17(3)(b))     | ✅ Documented above                |
| Model training data           | Retraining exclusion list        | ⚠️ Needs implementation            |
| AI-generated content          | Keep (Art. 17(3)(d))             | ✅ Documented above                |

Aggregated play counts survive erasure in anonymised, non-reversible form and are
excluded from the data export. That limitation is stated in the export itself so a
data subject is told rather than left to assume.
