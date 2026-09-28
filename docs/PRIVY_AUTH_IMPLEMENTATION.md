# Privy Authentication Implementation

## Overview
This document describes the Privy authentication integration for AudioBlock Backend. Privy provides wallet-less authentication and key management solutions.

## Configuration

### Environment Variables
Three environment variables are required to enable Privy authentication:

```bash
PRIVY_APP_ID=your_app_id
PRIVY_APP_SECRET=your_app_secret
PRIVY_VERIFICATION_KEY=your_verification_key
```

**Important:** All three variables must be provided together. Partial configuration will cause startup failure.

If Privy is not needed, leave all three variables unset. The application will log a warning and continue without Privy features.

### Automatic Validation
The `validateEnvironment()` function in `src/config/env.ts` automatically validates Privy configuration on startup:
- All three keys must be present or all absent
- Partial configuration triggers an error and exits
- Missing configuration logs a warning but doesn't block startup

## Endpoints

### POST /api/auth/privy/login
Authenticates a user with a Privy ID token.

**Request:**
```json
{
  "idToken": "privy_id_token_here"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Privy login successful",
  "accessToken": "jwt_token",
  "refreshToken": "refresh_token",
  "refreshTokenFamily": "token_family_id",
  "user": {
    "id": "user_id",
    "email": "user@example.com"
  }
}
```

### POST /api/auth/privy/refresh-token
Rotates the refresh token using token family tracking.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request:**
```json
{
  "refreshToken": "current_refresh_token"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Token rotated successfully",
  "accessToken": "new_jwt_token",
  "refreshToken": "new_refresh_token"
}
```

### POST /api/auth/privy/logout
Revokes all refresh tokens for the authenticated user.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "message": "Privy logout successful"
}
```

## CORS Configuration

Privy endpoints have dedicated CORS configuration:

- **Allowed Methods:** GET, POST, OPTIONS
- **Allowed Headers:** Authorization, Content-Type, X-Request-ID, X-Privy-ID-Token, X-Client-ID
- **Exposed Headers:** X-Request-ID, X-Refresh-Token-Family
- **Credentials:** Allowed
- **Max Age:** 1 hour (compared to 24 hours for general API)

The shorter max age provides additional security for authentication endpoints.

## Middleware

### requirePrivyAuth
Middleware that requires a valid Privy-authenticated user.

```typescript
import { requirePrivyAuth } from '../middlewares/privyMiddleware';

router.post('/protected', requirePrivyAuth, controllerMethod);
```

The middleware:
- Extracts Bearer token from Authorization header
- Verifies token signature using PRIVY_VERIFICATION_KEY
- Decodes user information and attaches to `req.privyUser`
- Returns 401 if authentication fails or Privy is not enabled

## Session Refresh Token Rotation

The `RefreshTokenService` implements secure token rotation using token families:

### Token Family Architecture
- Each login session creates a new token family
- Token rotation increments a counter without changing the family
- Token reuse detection prevents compromised token attacks

### Key Features
- **Automatic Expiration:** Tokens expire after 7 days
- **Reuse Detection:** If a token is replayed, the entire family is revoked
- **Maximum Rotations:** Limited to 100 rotations per family to prevent DoS
- **Atomic Operations:** Database transactions ensure consistency

### Database Schema
```sql
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  family VARCHAR NOT NULL,
  token VARCHAR NOT NULL,
  rotation INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  UNIQUE(user_id, family),
  INDEX(user_id),
  INDEX(expires_at)
);
```

### Usage
```typescript
import { RefreshTokenService } from '../services/RefreshTokenService';

const tokenService = new RefreshTokenService();

// Create initial refresh token
const { token, family } = await tokenService.createRefreshToken(userId);

// Rotate token
const rotated = await tokenService.rotateRefreshToken(userId, currentToken, family);

// Revoke specific token family
await tokenService.revokeRefreshToken(userId, family);

// Revoke all tokens for user
await tokenService.revokeAllUserTokens(userId);
```

## Security Considerations

### Token Reuse Prevention
When a token is rotated, the new token is stored and the old one is invalidated. If a client attempts to use an old token:
1. The token is not found in storage
2. The entire token family is revoked
3. All active sessions for that user are logged out

### Token Expiration
Refresh tokens have a 7-day TTL. Expired tokens are automatically cleaned up by querying the database.

### Rate Limiting
All Privy endpoints are subject to the same rate limiting as other auth endpoints:
- IP+email-based rate limiting for login
- Per-user rate limiting for refresh endpoints

### Verification Key Management
The Privy verification key should be:
- Stored securely in environment variables
- Never logged or exposed
- Rotated regularly according to security policy
- Only used server-side for token verification

## Migration

A database migration is provided to create the `refresh_tokens` table:
```bash
npm run typeorm migration:run
```

This creates the necessary schema with proper indices for performance.

## Testing

### Unit Tests
Test refresh token rotation logic:
```typescript
describe('RefreshTokenService', () => {
  it('should create and rotate refresh tokens', async () => {
    const service = new RefreshTokenService();
    const { token: token1, family } = await service.createRefreshToken('user1');
    const { newToken: token2 } = await service.rotateRefreshToken('user1', token1, family);
    expect(token1).not.toBe(token2);
  });

  it('should detect token reuse', async () => {
    const service = new RefreshTokenService();
    const { token, family } = await service.createRefreshToken('user1');
    const result = await service.rotateRefreshToken('user1', 'wrong_token', family);
    expect(result).toBeNull();
  });
});
```

### Integration Tests
Test the full flow:
```typescript
describe('Privy Auth Endpoints', () => {
  it('POST /api/auth/privy/login should return tokens', async () => {
    const response = await request(app)
      .post('/api/auth/privy/login')
      .send({ idToken: 'valid_privy_token' });
    
    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.refreshToken).toBeDefined();
  });

  it('POST /api/auth/privy/refresh-token should rotate token', async () => {
    const loginRes = await request(app)
      .post('/api/auth/privy/login')
      .send({ idToken: 'valid_privy_token' });

    const refreshRes = await request(app)
      .post('/api/auth/privy/refresh-token')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .send({ refreshToken: loginRes.body.refreshToken });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.refreshToken).not.toBe(loginRes.body.refreshToken);
  });
});
```

## Troubleshooting

### Privy Configuration Error on Startup
**Error:** "Incomplete Privy configuration"

**Solution:** Either:
1. Set all three Privy environment variables, or
2. Unset all three to disable Privy

### Privy Authentication Failures
**Error:** "Invalid Privy token"

**Possible Causes:**
- Token signature doesn't match PRIVY_VERIFICATION_KEY
- Token has expired
- Token format is invalid (not a JWT)

**Solution:** Verify the token comes from Privy and hasn't expired.

### Token Rotation Failures
**Error:** "Token not found" when rotating

**Cause:** Token family doesn't exist (user never logged in via Privy)

**Solution:** Ensure the login flow completes successfully first.

### CORS Issues with Privy Endpoints
**Error:** Browser blocks request due to CORS

**Solution:** Verify ALLOWED_ORIGINS includes your frontend domain and Privy headers are allowed in corsOptions.

## Related Issues
- #627: Environment variable validation on startup
- #628: CORS configuration for Privy endpoints
- #629: Security review checklist
- #630: Session refresh token rotation

## See Also
- [Security Checklist](./PRIVY_AUTH_SECURITY_CHECKLIST.md)
- [CORS Configuration](../src/config/cors.ts)
- [Privy Middleware](../src/middlewares/privyMiddleware.ts)
- [Refresh Token Service](../src/services/RefreshTokenService.ts)
