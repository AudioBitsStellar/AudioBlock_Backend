# Auth API collections (Postman / Insomnia)

`AudioBlock_Auth.postman_collection.json` is a Postman **v2.1** collection
covering every endpoint under `/api/auth` (issue #640).

## Importing

- **Postman:** _Import_ → _Files_ → select the JSON file. The collection
  appears as **AudioBlock Auth API** with its own variables.
- **Insomnia:** _Create_ → _Import/Export_ → _Import Data_ → **Postman** →
  select the same file (Insomnia reads Postman v2.1 collections directly).

## Setup

1. Point `baseUrl` at your server (default `http://localhost:4000/api/auth`).
2. Set your test account values: `email`, `username`, `password`,
   `dynamixUserId`, `walletAddress`.
3. Run requests top to bottom inside each folder. Scripted requests write
   `accessToken`, `refreshToken`, `partialToken`, and `totpSecret`
   automatically, so later folders just work.

## Flow overview

| Folder                              | What it exercises                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Registration & Nonce                | `GET /nonce/:email`, `POST /register`, `/register-listener`, `/register-email`           |
| Login & Sessions                    | `POST /login`, `/login-email`, `/refresh`, `/logout`, `/introspect`                      |
| Email Verification & Password Reset | `GET /verify-email/:token`, `POST /forgot-password`, `/reset-password/:token`            |
| Two-Factor (TOTP)                   | `POST /2fa/enable`, `/verify`, `/validate`, `/disable`                                   |
| Privy MFA                           | `GET /mfa/status`, `POST /mfa/sessions/revoke` (issue #639 — needs a Privy access token) |

Wallet-signature requests (`/register`, `/login`) need an off-band signature
over the nonce message: fetch `GET /nonce/:email`, sign the returned message
with the wallet key, then set `{{walletMessage}}` and `{{walletSignature}}`.

## Notes

- Auth routes are rate-limited (`AUTH_RATE_LIMIT_*`, `NONCE_RATE_LIMIT_*`,
  `PASSWORD_RESET_RATE_LIMIT_*`, `TWO_FACTOR_RATE_LIMIT_*` in `.env.example`);
  repeated failures return **429**.
- Error responses use `{ "success": false, "message": ..., "type": ... }`;
  `POST /introspect` is the exception — it always returns 200 (RFC 7662).
- Token reference: [ADR-001](../adrs/001-authentication-strategy.md),
  [token introspection](../TOKEN_INTROSPECTION.md),
  [Privy MFA](../PRIVY_MFA.md).
