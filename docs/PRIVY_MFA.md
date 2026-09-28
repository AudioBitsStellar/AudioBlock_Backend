# Privy MFA (Multi-Factor Authentication)

**Status:** implemented (issue #639) — part of the
[Privy Authentication (Backend)](https://github.com/AudioBitsStellar/AudioBlock_Backend/issues?q=is%3Aissue+Privy) initiative

This document describes how multi-factor authentication works for
Privy-authenticated requests: what the backend verifies, which endpoints exist,
and how it relates to the legacy TOTP implementation.

## How MFA works with Privy

- **Enrollment and challenges are handled by Privy.** Users enroll MFA methods
  (TOTP, SMS, passkey, or email) through Privy's client SDK; Privy enforces the
  challenge during login when MFA is required for the app (configured in the
  Privy dashboard). The backend never sees or verifies TOTP codes.
- **The backend's job is to trust Privy correctly.** It verifies Privy access
  tokens (ES256/EdDSA) against the app's verification key, reads the user's
  MFA enrollment from the Privy API, and can revoke all of a user's Privy
  sessions in an emergency.
- **MFA policy for backend routes:** an endpoint can require
  `enrolledInMfa === true` (via `GET /api/auth/mfa/status` or the
  `privyService.getMfaStatus()` service call) before performing sensitive
  actions. Enforcement of the actual second-factor challenge stays Privy's job.

## Configuration

| Variable                     | Required | Purpose                                                              |
| ---------------------------- | -------- | -------------------------------------------------------------------- |
| `PRIVY_APP_ID`               | yes      | Audience (`aud`) of access tokens; sent as the `privy-app-id` header |
| `PRIVY_APP_SECRET`           | yes      | Basic auth for the Privy REST API                                    |
| `PRIVY_JWT_VERIFICATION_KEY` | yes      | Public key for token signatures — PEM, base64 SPKI DER, or JWK JSON  |
| `PRIVY_API_URL`              | no       | Defaults to `https://api.privy.io`                                   |

When any of the three required values is missing, the endpoints below respond
with `502 PRIVY_NOT_CONFIGURED` and **legacy JWT authentication is unaffected**.
All four keys are documented in `.env.example`.

## Endpoints

Both endpoints authenticate with a **Privy access token** in the standard
`Authorization: Bearer <token>` header — not the legacy HS256 JWT, which they
reject. Both are rate-limited by the shared auth rate limiter.

### `GET /api/auth/mfa/status`

Returns the MFA enrollment of the authenticated Privy user.

```bash
curl -s -H "Authorization: Bearer $PRIVY_ACCESS_TOKEN" \
  https://api.example.com/api/auth/mfa/status
```

```json
{
  "success": true,
  "message": "MFA status retrieved",
  "sessionId": "session-abc123",
  "privyUserId": "did:privy:...",
  "enrolledInMfa": true,
  "mfaMethods": ["totp", "sms"]
}
```

- `sessionId` is the token's `sid` claim (`null` when absent).
- `enrolledInMfa` is derived from the Privy user's `mfa_methods` array
  (`true` when at least one method is enrolled).
- `mfaMethods` lists method types: `sms`, `totp`, `passkey`, `email`.

### `POST /api/auth/mfa/sessions/revoke`

Revokes **every active Privy session** for the authenticated user — the
response to a lost device or a suspicious-activity report. The client must log
the user out and re-authenticate (which re-runs the MFA challenge).

```bash
curl -s -X POST -H "Authorization: Bearer $PRIVY_ACCESS_TOKEN" \
  https://api.example.com/api/auth/mfa/sessions/revoke
```

```json
{
  "success": true,
  "message": "All Privy sessions revoked",
  "privyUserId": "did:privy:..."
}
```

## Token verification rules

Implemented in `src/services/PrivyService.ts` (`verifyAccessToken`):

1. Structure: exactly three non-empty base64url segments.
2. Algorithm: `ES256` or `EdDSA` only — `none`, `HS256`, and anything else is
   rejected (`PRIVY_TOKEN_BAD_ALGORITHM`). Legacy HS256 JWTs are never
   accepted here; they belong to `requireAuth`/`JWT_SECRET`.
3. Signature: verified against `PRIVY_JWT_VERIFICATION_KEY` (raw IEEE P1363
   ECDSA signatures are converted to DER for verification).
4. Issuer (`iss`): `privy.io` or `https://privy.io`.
5. Audience (`aud`): must include `PRIVY_APP_ID`.
6. Subject (`sub`): must be present (the Privy user DID).
7. Expiry (`exp`): enforced with 30 seconds of clock-skew tolerance.

## Error responses

Errors use the standard shape `{ "success": false, "message": ..., "type": ... }`
(see `handleError` in `src/utils/helpers.ts`).

| HTTP | Code / `type`                                                                                                                                                                                                                           | Meaning                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 401  | `PRIVY_TOKEN_MISSING` / `UNAUTHORIZED`                                                                                                                                                                                                  | No `Authorization: Bearer` header                          |
| 401  | `PRIVY_TOKEN_MALFORMED`, `PRIVY_TOKEN_BAD_ALGORITHM`, `PRIVY_TOKEN_INVALID_SIGNATURE`, `PRIVY_TOKEN_INVALID_ISSUER`, `PRIVY_TOKEN_INVALID_AUDIENCE`, `PRIVY_TOKEN_INVALID_SUBJECT`, `PRIVY_TOKEN_INVALID_CLAIMS`, `PRIVY_TOKEN_EXPIRED` | Token failed one of the checks above                       |
| 404  | `PRIVY_USER_NOT_FOUND`                                                                                                                                                                                                                  | No such user in the Privy app                              |
| 502  | `PRIVY_NOT_CONFIGURED`                                                                                                                                                                                                                  | `PRIVY_APP_ID`/`APP_SECRET`/verification key missing       |
| 502  | `PRIVY_API_ERROR`, `PRIVY_API_UNREACHABLE`, `PRIVY_API_INVALID_RESPONSE`                                                                                                                                                                | Privy REST API failure (issue #635 covers resilience)      |
| 500  | `PRIVY_KEY_INVALID`                                                                                                                                                                                                                     | `PRIVY_JWT_VERIFICATION_KEY` is not a parseable public key |
| 429  | —                                                                                                                                                                                                                                       | Shared auth rate limiter                                   |

## Relationship to the existing TOTP implementation

The legacy local TOTP flows (`POST /api/auth/2fa/enable|verify|disable|validate`,
`src/services/AuthService.ts`) are **unchanged and still active** for accounts
that have not moved to Privy. They are removed in Phase 5 of the
[Privy migration guide](PRIVY_MIGRATION_GUIDE.md), after users with local 2FA
enabled have enrolled in Privy MFA (Segment C).

## Testing

`src/__tests__/privyMfa.test.ts` covers token verification (valid ES256/EdDSA
tokens, key formats, wrong issuer/audience/expiry/signature, `alg:none`,
legacy HS256 rejection), MFA status mapping and Privy API failure modes,
session revocation, and both controller endpoints:

```bash
npx jest src/__tests__/privyMfa.test.ts
```

## Related issues

#595 (env config), #597/#598 (token verification middleware), #600/#602
(identity linking), #621 (middleware tests), #624 (invalid-token handling),
#634 (key caching), #635 (Privy downtime), #636 (feature flag), #639 (this
issue), #637 (migration guide).
