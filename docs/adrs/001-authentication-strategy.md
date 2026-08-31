# ADR-001: Authentication Strategy

**Date:** 2024-01-01
**Status:** Accepted
**Deciders:** Core team

## Context

AudioBlock Backend serves two user roles — artists and listeners — with different permission levels. The frontend clients are separate SPAs (artist dashboard, listener app) running on different origins. We need a stateless, scalable auth mechanism that:

- Works across multiple front-end origins without shared session storage
- Supports wallet-signature login (Stellar/EVM) for Web3 users as well as traditional email + password
- Provides a path to 2FA (TOTP) without changing the token format
- Can be validated by Express middleware with no database round-trip per request

## Decision

Use **short-lived JWTs (15 min access token)** signed with `HS256` issued by the backend on successful login, combined with **opaque refresh tokens** stored in `HttpOnly` cookies with `SameSite=Strict`. The refresh token is persisted in the database and can be revoked explicitly.

Wallet-based login follows a nonce-challenge flow: the client fetches `GET /api/auth/nonce/:email`, signs the nonce with their private key, then sends the signature to `POST /api/auth/login`. The server verifies the signature and issues tokens identically to the password flow.

2FA (TOTP via otplib) is an opt-in layer that gates the token issuance step — the initial login returns a `mfaRequired` flag and a short-lived session cookie; the TOTP code is then submitted to `/api/auth/2fa/verify`.

## Consequences

### Positive

- No session store needed; any horizontal replica can validate a JWT
- Refresh-token rotation means compromised access tokens expire quickly
- Both wallet and email flows produce the same token shape, simplifying middleware
- 2FA can be added without changing the token structure

### Negative / trade-offs

- Short expiry (15 min) means frequent silent refreshes in the client
- HS256 shares one secret across all instances — a key rotation requires a rolling restart
- Revoking an access token before expiry requires an in-memory or Redis deny-list

### Neutral

- `requireAuth`, `authArtistMiddleware`, and `authListenerMiddleware` all decode the same JWT; role gating happens via the `role` claim

## Alternatives considered

| Option                              | Why rejected                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| Session cookies (server-side store) | Requires sticky sessions or a shared Redis session store, complicates horizontal scaling   |
| Long-lived JWTs (no refresh)        | Cannot revoke on logout or compromise; high blast radius for a leaked token                |
| OAuth2 / third-party IdP            | Over-engineered for an internal API; Web3 wallet login does not map cleanly to OAuth flows |
