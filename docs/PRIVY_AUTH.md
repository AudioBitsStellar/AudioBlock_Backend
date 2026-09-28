# Privy Authentication: Resilience & Rollout

Covers the parts of the Privy migration that are about *keeping the login path up*
and *moving traffic over safely*:

- [#634](#634-caching-privy-signing-keys) — caching the public keys used to verify tokens
- [#635](#635-surviving-privy-downtime) — retry, circuit breaking, and stale-key serving
- [#636](#636-the-auth-mode-feature-flag) — toggling between legacy and Privy auth

Account deletion and GDPR compliance ([#633](GDPR_AI_ABILITY.md)) are documented
separately, since they apply to both auth modes.

---

## How a Privy request is verified

A Privy access token is an **ES256** JWT issued by `privy.io`, scoped to this app:

| Claim    | Meaning                                     |
| -------- | ------------------------------------------- |
| `sub`    | Privy identity id (`did:privy:…`)            |
| `sid`    | Privy session id                            |
| `iss`    | Always `privy.io`                           |
| `aud`    | Always this app's `PRIVY_APP_ID`            |
| `exp`    | Expiry — enforced independently of the key  |

Two steps, in order:

1. Read the `kid` header, resolve the matching public key from the cached JWKS.
2. Verify the signature and the claims against that key.

Three properties of this are load-bearing, and each has a test:

- **The algorithm is pinned, never read from the token.** Taking `alg` from the
  header is how JWT verification is subverted: an attacker re-signs a token using
  the *public key* as an HMAC secret (`alg: HS256`), and a verifier that trusts the
  header accepts it. `algorithms: ['ES256']` is hard-coded.
- **`iss` and `aud` are checked explicitly**, so a valid Privy token minted for a
  different app cannot be replayed against this one.
- **`typ` must be `JWT`**, so an identity token (different lifetime and audience
  semantics) cannot be replayed through the access-token path.

`src/services/privy/PrivyTokenVerifier.ts`

---

## #634: Caching Privy signing keys

`src/services/privy/PrivyJwksCache.ts`

Verifying a token needs the app's signing keys, served as a JWKS document at a
public URL. Fetching it per request would put a third-party round trip — and a
third-party failure mode — in front of every authenticated call, and make Privy's
availability a hard prerequisite for the whole API. The keys rotate rarely, so
they are cached per process.

| Mechanism                | Why it exists                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single-flight**        | Concurrent misses collapse onto one fetch. Otherwise a cold start under load fires N identical requests and earns a rate limit.                    |
| **TTL + stale window**   | Expiry is a *refresh* trigger, not invalidation. Discarding a working key turns a routine refresh failure into an auth outage.                        |
| **Negative cache**       | A kid we already looked up and rejected is refused outright, so replaying one bad kid cannot generate a request each time.                           |
| **Refetch cooldown**     | Bounds a flood of *random* kids to one request per window, so we cannot be turned into a load generator against our own JWKS endpoint.             |

Two things worth being precise about:

- **Rotation is bounded by the cooldown (60s), not the TTL (1h).** A newly-seen
  kid earns one fetch attempt as soon as the cooldown lapses. If it had to wait
  out the full key-set TTL, every client holding a rotated key would be locked out
  for up to an hour.
- **Serving a stale key cannot extend a token's life.** `exp` is enforced
  independently, so a stale key only affects whether a *still-valid* token is
  accepted, never whether an expired one is.

The cache is per-process deliberately. A shared cache would have to be invalidated
correctly across the fleet on rotation, and the failure mode of getting that wrong
is accepting a revoked key.

**Tuning** (`.env`): `PRIVY_JWKS_TTL_MS`, `PRIVY_JWKS_STALE_TTL_MS`,
`PRIVY_JWKS_NEGATIVE_TTL_MS`.

---

## #635: Surviving Privy downtime

`src/services/privy/PrivyResilience.ts`

A naive retry loop makes an outage worse by multiplying load on an
already-struggling upstream, so the two mechanisms here keep the damage bounded.

**Retry with exponential backoff and full jitter.** Full jitter (a uniform draw
from `[0, delay]`) rather than fixed backoff: when a whole fleet fails at the same
instant, fixed delays re-synchronise them into a repeating thundering herd. A
server-supplied `Retry-After` always wins over our own backoff. Only genuinely
transient failures are retried — connection errors and HTTP 408/429/5xx. Any other
4xx, and any unrecognised error, is permanent, so a programming error is not
silently retried five times.

**Circuit breaker.** After N consecutive failures the breaker opens and
short-circuits further calls, so an outage costs a predictable near-zero-latency
error instead of a timeout per request. One probe is then admitted to test
recovery; concurrent callers are collapsed so a recovering upstream is not hit by
a herd of probes. The breaker is *outside* the retry loop, so a call that
internally rode out a blip counts once, not once per attempt.

### What "graceful" means in practice

A Privy ES256 token can never be verified by the legacy HS256 verifier, so there is
**no token-level fallback** — pretending otherwise would be a fiction. What
actually keeps a staged rollout alive through a Privy outage is:

1. **Stale JWKS keys keep verifying throughout.** With a warm cache there is no
   user-visible impact at all.
2. **Legacy-issued tokens authenticate normally the whole time**, because that path
   never touches the Privy API. This is the real fallback: a mixed fleet keeps
   serving while Privy users wait.
3. **Availability failures return a retryable `503`, never a `401`.** This one
   matters more than it looks. Clients treat a 401 as "your credential is no
   good" and typically discard a valid session, so a 30-second Privy blip would
   otherwise sign every active user out.
4. **`AUTH_MODE=legacy` remains the instant operator rollback.**

A *rejected* token — bad signature, expired, unknown key — never falls back under
any configuration. Failing closed there is a security property, not a policy knob.

**Error mapping:**

| Situation                                    | Response                                     |
| -------------------------------------------- | -------------------------------------------- |
| Bad signature / expired / wrong `aud`         | `401 UNAUTHORIZED`                            |
| Unknown `kid` (key rotation in progress)      | `401 UNAUTHORIZED`                            |
| Privy unreachable, nothing cached             | `503 PRIVY_UNAVAILABLE` + `details.retryable` |
| Privy unreachable, stale keys available       | verifies normally                             |
| Privy identity valid, no local account yet    | `409 PRIVY_USER_NOT_SYNCED`                   |
| Account deleted or deletion pending           | `403`                                         |

**Tuning:** `PRIVY_RETRY_ATTEMPTS`, `PRIVY_RETRY_BASE_DELAY_MS`,
`PRIVY_RETRY_MAX_DELAY_MS`, `PRIVY_CIRCUIT_FAILURE_THRESHOLD`,
`PRIVY_CIRCUIT_RESET_TIMEOUT_MS`, `PRIVY_CIRCUIT_STARTS_OPEN`,
`PRIVY_ALLOW_STALE_KEYS`.

---

## #636: The `AUTH_MODE` feature flag

`src/config/authFlags.ts`

A single boolean is not enough to express a staged migration: "Privy on, legacy
off" as one toggle means a bad Privy release logs everybody out, and there is no
way to run both and compare before committing. So the mode is an explicit enum:

| `AUTH_MODE` | legacy `requireAuth` | Privy `requireAuth` | Intended use                        |
| ----------- | -------------------- | ------------------ | ----------------------------------- |
| `legacy`   | yes                  | no                 | default / pre-migration / rollback  |
| `both`     | yes                  | yes                | staged rollout                      |
| `privy`    | no                   | yes                | after legacy signups have drained   |

**Defaults to `legacy`.** With no `AUTH_MODE` set, behaviour is exactly what it was
before this flag existed.

The token is routed by its `alg` header: legacy tokens are HS256, Privy tokens are
ES256, so the algorithm identifies the credential type exactly. Nothing is trusted
here — `alg` only selects *which* verifier runs, and each verifier re-checks the
algorithm itself.

**`PRIVY_ALLOW_LEGACY_FALLBACK`** governs what a *known* outage does to legacy
traffic:

- `true` (default) — legacy requests keep working, Privy requests get a retryable
  503. Availability is preserved.
- `false` — a degraded Privy fails **all** auth with 503, so clients see one
  uniform retryable failure instead of a population split across two behaviours
  mid-incident. Some operators prefer that; it is opt-in.

**Boot-time validation.** The server refuses to start if Privy is enabled but
`PRIVY_APP_ID` is missing. That combination would reject every request with a 401
that looks like a client bug; failing at boot is far easier to diagnose. The
resolved mode is logged at startup.

### Rollout order

1. Deploy with `AUTH_MODE=legacy` + `PRIVY_APP_ID` set. Nothing changes.
2. `AUTH_MODE=both`. Legacy and Privy tokens both work. Watch
   `privy_token_verifications_total`, `privy_jwk_cache_hits_total`, and
   `privy_circuit_state`.
3. `AUTH_MODE=privy` once legacy signups have drained.

Rolling back is setting `AUTH_MODE=legacy` and restarting — no deploy needed.

---

## Metrics

| Metric                                | Labels    | Watch it for                                            |
| ------------------------------------- | --------- | ------------------------------------------------------- |
| `privy_jwk_cache_hits_total`          | —         | should dominate; a low ratio means the cache is thrashing |
| `privy_jwk_cache_misses_total`        | —         | a spike usually means a cache key mismatch or a rotation |
| `privy_jwk_unknown_kid_total`         | —         | sustained non-zero with no rotation = probing            |
| `privy_jwk_fetches_total`             | `outcome` | `stale_served` > 0 means refreshes are failing          |
| `privy_token_verifications_total`     | `outcome` | `invalid` vs `unavailable` — very different problems     |
| `privy_circuit_state`                 | `state`   | `1` on `open` = Privy is down                            |
| `privy_auth_fallbacks_total`          | —         | availability failures, deliberately kept separate from rejections |

Alert on `privy_circuit_state{state="open"}` and on
`rate(privy_jwk_fetches_total{outcome="stale_served"}[5m]) > 0`. Do **not** alert
on the sum of `privy_token_verifications_total` — that would fire on credential
stuffing.

---

## Security fix carried in this change: `requirePrivyAuth` (#703)

`main` briefly shipped an **authentication bypass** in `src/middlewares/privyMiddleware.ts`
via #703. The middleware base64-decoded the token payload and read `sub` straight
out of it, accepting a `verificationKey` argument and never using it:

```ts
// before — accepts `x.eyJzdWIiOiJ2aWN0aW0ifQ.y` as any user
function decodePrivyToken(token: string, verificationKey: string): PrivyUser | null {
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
  return { id: payload.sub || payload.id, ... };   // verificationKey unused
}
```

It guards `POST /api/auth/privy/refresh-token`, which mints a
`JWT_SECRET`-signed access token for `privyUser.id` — so anyone could mint a
valid one-hour session for an arbitrary user id. User ids are UUIDs but are
exposed in ordinary public API responses, so this was a practical account
takeover, not a theoretical one.

It now routes through {@link verifyPrivyAccessToken}, i.e. a real signature and
claim check against the cached JWKS, with the same error semantics as the rest of
the integration (401 for a rejection, retryable 503 for an availability failure).
Regression tests in `src/middlewares/__tests__/privyMiddleware.test.ts` cover the
forged-payload case, a foreign signing key, expiry, wrong audience, wrong issuer,
and `alg: none`.

`PRIVY_VERIFICATION_KEY` from #703 is retained in `.env.example` as an alternative
to the JWKS endpoint, but is not used for verification: an SPKI public key gives
no `kid`, so it cannot be matched against a token header, and JWKS is what
supports key rotation without a deploy.

---

## Why not the `@privy-io/node` SDK

Implemented against Privy's documented REST surface and `jsonwebtoken` (already a
dependency, and it supports ES256). Every published version of `@privy-io/node`
declares a **peer dependency on `viem@^2.44`**, which conflicts with the
`viem@2.38.2` this repo has pinned transitively through
`@dynamic-labs-wallet/node-evm`; adding it makes `npm install` fail outright. The
one management endpoint needed for GDPR deletion is a single authenticated
`DELETE`, which is not worth that. See #594, which remains open and should
re-evaluate once the `viem` pin can move.

---

## Not in this change

These are separate issues and remain open. This document is honest about the gaps
rather than implying the migration is complete:

- **#600 / #602** — creating the local user on first Privy login. Until then a
  Privy identity with no local row gets a `409 PRIVY_USER_NOT_SYNCED`; the
  middleware deliberately does not auto-provision, because it lacks the identity
  token needed to set a username and role, and guessing at a matching email would
  let anyone claim an existing account.
- **#594, #596, #597, #598** — the SDK dependency, client singleton, and
  verification middleware were reimplemented here at the minimum size these four
  issues required. They should be reconciled or closed.
- **#603–#606, #610, #611, #613, #614, #615** — webhooks, login methods, Stellar
  wallet linking, MFA, and RBAC on top of Privy identity.
- **#624, #626, #627, #628** — error-handling hardening, env validation, CORS, and
  README setup docs. Several are partly addressed here.
- **#637, #639** — migration guide and MFA.
