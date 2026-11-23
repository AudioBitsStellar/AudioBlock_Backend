# Age Policy and Minimum Signup Age

**Status: draft.** The threshold and the legal basis must be signed off by the account owner or counsel before launch (issue COMP-06). The code enforces whatever value is configured.

## Policy

1. **Minimum age to create an account is 18** by default.
2. The minimum can be changed with `MINIMUM_SIGNUP_AGE`. Valid values are whole numbers from **13 to 99**. An unset, non-integer or out-of-range value falls back to **18**, so a typo cannot silently lower the gate.
3. The check runs at signup. It is a **self-declaration**: the applicant gives a date of birth. No identity document is checked.
4. The date of birth is **used for the check and then discarded**. It is not stored, and the `users` table has no date-of-birth column. This is deliberate data minimisation.
5. A change to `MINIMUM_SIGNUP_AGE` applies to new signups only. Existing accounts are not reviewed or closed. Changing the gate needs a restart of the API.

## Why 18

AudioBlocks accounts hold royalty payouts, sign royalty templates and collaborator agreements, and can connect on-chain wallets. In most jurisdictions a minor generally cannot enter binding agreements like these on their own. The default is therefore set to the age of majority, not to a regulatory floor.

Lower values may be justified for listener-only accounts in some markets. Examples are COPPA (US, 13) and the GDPR children's consent age (EU, 13 to 16 depending on the member state). A lower value would need counsel's sign-off and a separate rule for artist accounts. That rule is not implemented.

## What the signup check does

`POST /api/auth/register-email` now requires a `dateOfBirth` field in `YYYY-MM-DD` format.

| Input | Response |
| ----- | -------- |
| Missing, or wrong format | `400` `VALIDATION_FAILED` |
| Not a real calendar date (for example `2001-02-30`), or in the future | `400` `VALIDATION_FAILED` |
| Younger than the minimum | `403` with the message `You must be at least <N> years old to create an account.` |
| Meets the minimum | Account created, as before |

The age check runs **before** the duplicate-email lookup, so the response for an under-age applicant does not reveal whether an account already exists.

Age is calculated in whole years in UTC, so a person turns the minimum age on their birthday.

## Scope and known gaps

| Signup path | Covered? | Notes |
| ----------- | -------- | ----- |
| `POST /api/auth/register-email` | **Yes** | The email and password path. |
| Privy login and the Privy user webhook (`/api/webhooks/privy`) | **No** | Privy creates the user, and no date of birth is collected. Before launch, the client must collect the date of birth and the backend must check it. This needs a product decision. |
| `POST /api/auth/register` and `/register-listener` (wallet signature) | **No** | Legacy. These return `410 Gone` unless `ENABLE_LEGACY_EVM_AUTH=true`. If that flag is ever turned on, add the same check to those routes. |
| Admin-created or seeded accounts | **No** | Created by operators, not through public signup. |

**Action before launch:** the Privy path is the main gap. If Privy is the primary login, the age gate is not in effect for most new users until the client collects a date of birth.

## Breaking change for API clients

`POST /api/auth/register-email` now rejects requests without `dateOfBirth`. Clients must send it. Update any client, Postman collection or integration test that calls this route.

## Verification

- Unit tests: `src/__tests__/minimumAge.test.ts` (date arithmetic, configuration fallback, error codes) and the minimum-age cases in `src/__tests__/AuthService.test.ts`.
- Integration tests: the `register-email` payloads in `tests/integration/` include an adult `dateOfBirth`.

## Related

- Environment variable: `MINIMUM_SIGNUP_AGE` in [environment-variables.md](environment-variables.md).
- Processor register: [THIRD_PARTY_PROCESSORS.md](THIRD_PARTY_PROCESSORS.md).
