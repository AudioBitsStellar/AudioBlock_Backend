# Privy Server SDK Evaluation — Research Spike (#593)

## Summary

Evaluated the `@privy-io/node` server SDK for Node/Express integration against a
hand-rolled approach using native `crypto` and `fetch`.

## Decision

**Use native `crypto` + `fetch` instead of the official SDK.**

## Rationale

| Criterion | `@privy-io/node` SDK | Native (chosen) |
|-----------|----------------------|-----------------|
| Bundle size | ~2 MB with transitive deps | Zero additional deps |
| Token verification | Wraps `jose`; adds dep chain | Direct `crypto.verify` with ES256 |
| API calls | Thin wrapper over fetch | Direct fetch with Basic auth |
| JWKS caching | Built-in but opaque | Custom `PrivyJwksCache` with stale-while-revalidate |
| Resilience | No circuit breaker / retry | `PrivyResilience` with breaker + retry + backoff |
| Type safety | SDK types may drift from API | Hand-typed interfaces match our needs |
| Control | Black-box upgrades | Full control over signature normalization, claim validation |

## Key findings

1. Privy access tokens are ES256 JWTs. Node's native `crypto.verify` handles
   this directly after converting IEEE P1363 (raw r||s) signatures to DER/ASN.1.
2. The Privy REST API uses Basic auth (`appId:appSecret`). No SDK needed.
3. JWKS rotation is handled by a custom cache with configurable TTLs and
   stale-while-revalidate semantics (`PrivyJwksCache`).
4. Circuit breaking and retry logic are implemented in `PrivyResilience`,
   which the SDK does not provide.

## Implementation locations

- Config: `src/config/privy.ts`, `src/config/privyAuth.ts`
- Token verification: `src/services/privy/PrivyTokenVerifier.ts`
- JWKS cache: `src/services/privy/PrivyJwksCache.ts`
- Resilience: `src/services/privy/PrivyResilience.ts`
- Service singleton: `src/services/PrivyService.ts`
- Middleware: `src/middlewares/privyMiddleware.ts`
- User resolver: `src/services/privy/PrivyUserResolver.ts`
- Session management: `src/services/privy/PrivySessionService.ts`
- Webhooks: `src/services/privy/PrivyWebhookService.ts`

## Tests

- `src/services/privy/__tests__/PrivyTokenVerifier.test.ts`
- `src/services/privy/__tests__/PrivyJwksCache.test.ts`
- `src/services/privy/__tests__/PrivyResilience.test.ts`
- `src/services/privy/__tests__/PrivyWebhookService.test.ts`
- `src/middlewares/__tests__/privyMiddleware.test.ts`