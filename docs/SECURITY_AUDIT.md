# Security Audit Report

## #329: API Key Scoping and Permissions Audit

### Current State
- API keys support three scopes: `READ_ONLY`, `UPLOAD`, `ADMIN`
- Keys have granular permission strings that cannot exceed the owning user's role
- Rate limiting is tiered per key: standard (100/min), high (500/min), unlimited (10k/min)

### Findings
1. **Scope enforcement**: `requireApiKeyScope()` middleware correctly gates routes by scope
2. **Permission escalation prevention**: Key permissions are validated against user role at issue time and on every request
3. **Key hash storage**: Keys are stored as SHA-256 hashes, never plaintext
4. **Revocation**: Keys can be revoked via `isRevoked` flag, checked on every request

### Recommendations
- [x] Keys are scoped and permission-limited
- [ ] Add key rotation endpoint (currently requires delete + recreate)
- [ ] Add key usage audit log (currently only `lastUsedAt` timestamp)

---

## #330: JWT Expiry and Refresh-Token Rotation Audit

### Current State
- JWT tokens are verified on every request via `requireAuth` middleware
- Refresh tokens stored in `refresh_tokens` entity with device fingerprinting

### Findings
1. **JWT verification**: Uses `jsonwebtoken.verify()` with `JWT_SECRET` env var
2. **Token lifetime**: Should be configured via `expiresIn` in jwt.sign() — verify in auth service
3. **Refresh rotation**: Refresh tokens are single-use (consumed on use, new one issued)
4. **Device binding**: Refresh tokens are bound to device fingerprint

### Recommendations
- [x] Refresh tokens are single-use and device-bound
- [ ] Verify JWT expiry is set (check `authService.ts` for `expiresIn`)
- [ ] Add token family tracking to detect refresh token reuse

---

## #339: Security Headers (Helmet/CORS) Audit

### Current State
- Express app with helmet middleware for security headers
- CORS configured via environment variable

### Findings
1. **Helmet**: Provides default security headers (X-Frame-Options, X-Content-Type-Options, etc.)
2. **CORS**: Configurable origins via `CORS_ALLOWED_ORIGINS` env var
3. **HSTS**: Should be enabled in production

### Recommendations
- [x] Helmet middleware is active
- [x] CORS is configurable
- [ ] Ensure `helmet()` includes `hsts` in production
- [ ] Add `Content-Security-Policy` header for XSS protection
- [ ] Set `X-Permitted-Cross-Domain-Policies: none` for SWF/Flash policy
