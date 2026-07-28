# Changelog

All notable changes to the AudioBlocks Backend API are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- JSDoc comments to all public service methods for IDE hover documentation (#139)

### Security

- Hardened password reset: URL-safe 32-byte reset tokens (base64url), 1-hour token expiry, prior tokens invalidated on each new request, and a dedicated 3-requests/hour/email rate limiter on `POST /api/auth/forgot-password` (#102)
- Complete environment variable reference documentation (#142)
- API changelog tracking breaking changes, features, and deprecations (#141)
- Comprehensive README setup guide with prerequisites, Docker, and troubleshooting (#140)

## [1.2.0] - 2025-01-15

### Added

- OpenAPI specification, ADRs, issue templates, and Prettier setup (#137, #138, #166, #168)
- Prometheus metrics + Grafana monitoring stack (#179)
- Background job queue with priority levels and dead-letter queue (#132)
- Precomputed inverted search index for songs (#135)
- Database connection pooling with health checks and metrics (#134)
- ETag + conditional request caching middleware (#134)

### Fixed

- Service validation, thin controllers, circular dependencies, and extracted constants (#155, #156, #160, #162)
- Backend issues: content moderation, analytics, and auth flows (#149, #154, #159, #161)
- CORS environment configuration (#59)
- Marketplace Soroban relay (#60)
- Coordinate transaction timing and define error codes (#57, #58)

### Removed

- Deprecated `twitterRoutesOld` file

## [1.1.0] - 2024-12-01

### Added

- Malware scanning step (ClamAV) to upload pipeline (#38)
- Worker retry/backoff and dead-letter queue for song jobs (#36)
- IP+email rate limiting to all auth endpoints (#29)
- Structured pino logger with request correlation (#33)
- Song flag/unflag endpoints for content moderation (#44)
- Song analytics and email auth recovery flows (#52)
- Startup environment-variable validation (#62)
- S3 lifecycle policy documentation (#63)
- Docker vulnerability scanning (#179)

### Fixed

- Health-check smoke test, fixed missing pino-pretty dependency (#26)
- Chunk upload size limit now configurable, returns 413 on overflow (#27)
- Honor incoming `X-Request-Id` header (#22)
- Remove dead commented-out `main()` block (#23)

## [1.0.0] - 2024-10-01

### Added

- Initial release of AudioBlocks Backend
- User authentication via wallet-signature (EVM) and email/password
- TOTP two-factor authentication for email/password accounts
- Song upload pipeline with chunked upload, S3 storage, and HLS transcoding
- Soroban on-chain integration: artist setup and song minting relay
- IPFS metadata pinning via Pinata
- Album and genre management
- Artist profile management with image uploads
- RabbitMQ-based background song processing worker
- Redis-backed nonce storage and session caching
- Transaction audit logging
- Royalty payout tracking and reconciliation
- Marketplace listing and buying via Soroban relay
- Twitter OAuth2 PKCE account linking
- TypeORM database migrations
- Jest test suite

---

## Versioning

- **Major** (X.0.0): Breaking API changes (endpoint removal, auth flow changes)
- **Minor** (0.X.0): New features and capabilities
- **Patch** (0.0.X): Bug fixes and documentation updates

## Links

- [Repository](https://github.com/AudioBitsStellar/AudioBlock_Backend)
- [Issues](https://github.com/AudioBitsStellar/AudioBlock_Backend/issues)
