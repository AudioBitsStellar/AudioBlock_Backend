# Token Introspection Endpoint (RFC 7662)

## Overview

The Token Introspection endpoint allows internal AudioBlock microservices and indexers to verify the authenticity, validity, and metadata of access tokens without sharing secret keys across all services.

## Specification

- **Method**: `POST`
- **Path**: `/api/v1/auth/introspect` (or `/auth/introspect`)
- **Content-Type**: `application/json`

### Request Payload

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type_hint": "access_token"
}
```

### Responses

#### Active / Valid Token (`200 OK`)

```json
{
  "active": true,
  "scope": "read write internal",
  "client_id": "audioblock-internal",
  "token_type": "Bearer",
  "sub": "b2c8a149-8df3-4eb5-9d33-4f9382103fbc",
  "user_id": "b2c8a149-8df3-4eb5-9d33-4f9382103fbc",
  "username": "cosmicartist",
  "email": "artist@audioblock.io",
  "role": "artist",
  "wallet_address": "0x1234567890abcdef...",
  "stellar_public_key": "GBEMIAUDIOBLOCK...",
  "name": "Cosmic Artist",
  "email_verified": true,
  "exp": 1727468400,
  "iat": 1727467500,
  "iss": "AudioBlock"
}
```

#### Inactive / Expired / Invalid Token (`200 OK`)

Per RFC 7662 section 2.2, if the token is invalid, expired, or revoked, the response HTTP status code is `200 OK` with `active: false`:

```json
{
  "active": false
}
```
