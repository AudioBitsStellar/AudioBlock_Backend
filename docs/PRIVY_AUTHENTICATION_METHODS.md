# Privy Authentication Methods

**Status:** Implemented (Issues #609, #610, #611, #613)
**Part of:** [Privy Authentication (Backend)](https://github.com/AudioBitsStellar/AudioBlock_Backend/issues?q=is%3Aissue+Privy) initiative

This document describes the authentication and account linking methods supported through Privy integration in AudioBlock Backend.

## Overview

AudioBlock Backend now supports multiple authentication methods through Privy, allowing users to:

- Link multiple authentication methods to a single account (email + wallet)
- Sign in with social providers (Google, Twitter/X)
- Use email or SMS OTP for passwordless authentication
- Connect external wallets (MetaMask, WalletConnect)

All authentication flows are handled by Privy on the client side, with the backend responsible for:

1. Verifying Privy-issued tokens
2. Creating or linking local user accounts
3. Processing webhook events for account updates
4. Maintaining user profile data

## Supported Authentication Methods

### 1. Account Linking (Issue #609)

Users can link multiple authentication methods to a single account. The linking logic follows these rules:

**Linking Precedence:**

1. Verified exact email match (case-insensitive)
2. Exact wallet-address match
3. User-confirmed explicit linking

**Security Rules:**

- Never auto-link on unverified email claims
- One local account maps to one Privy user ID (enforced by unique constraint)
- Linking is logged for audit purposes

**Example Flow:**

1. User signs up with email
2. Later connects wallet → automatically linked to existing account
3. User's sessions work with either authentication method

### 2. Social Login Providers (Issue #610)

Supported providers via Privy:

- **Google:** OAuth 2.0 flow with email and profile data
- **Twitter/X:** OAuth flow with username and profile information

**Backend Handling:**

**Google Account:**

- Email is synced to user profile if verified
- Profile image can be imported
- Email verification status is preserved

**Twitter/X Account:**

- Username stored in `twitterUsername`
- Twitter ID stored in `twitterId`
- Display name stored in `twitterDisplayName`
- Profile image URL stored in `twitterProfileImage`
- Verified status stored in `twitterVerified`
- Connection status tracked in `twitterConnected`

**Token Payload:**

```json
{
  "sub": "did:privy:abc123",
  "email": "user@example.com",
  "linked_accounts": [
    {
      "type": "google",
      "email": "user@gmail.com",
      "verified_email": true
    },
    {
      "type": "twitter",
      "username": "johndoe",
      "subject": "twitter_id_123",
      "name": "John Doe",
      "profile_picture_url": "https://...",
      "verified": true
    }
  ]
}
```

### 3. SMS/Email OTP Login (Issue #611)

Privy supports passwordless authentication via one-time passwords:

- **Email OTP:** User receives code via email
- **SMS OTP:** User receives code via SMS

**Backend Behavior:**

- Email authenticated via OTP is marked as verified by default
- Phone numbers are acknowledged but not stored in a dedicated column (future enhancement)
- OTP verification is handled entirely by Privy

**Benefits:**

- No password management required
- Reduces account takeover risk
- Better user experience for mobile users

### 4. External Wallet Connect (Issue #613)

Support for external wallet providers:

- **MetaMask:** Browser extension wallet
- **WalletConnect:** Mobile wallet connection protocol
- **Other Injected Wallets:** Any wallet implementing the EIP-1193 standard

**Detection Logic:**

```typescript
const externalWallets = linkedAccounts.filter(
  (acc: any) =>
    acc.type === 'wallet' &&
    (acc.wallet_client === 'metamask' ||
      acc.wallet_client === 'walletconnect' ||
      acc.connector_type === 'injected' ||
      acc.connector_type === 'wallet_connect'),
);
```

**Wallet Linking:**

- Wallet address is extracted from Privy token
- Address is linked to user account if not already set
- Multiple wallets can be acknowledged, but only primary is stored
- Wallet client type is lo
  ens

**Response:**

```json
{
  "success": true,
  "message": "Privy login successful",
  "accessToken": "jwt_token",
  "refreshToken": "refresh_token",
  "refreshTokenFamily": "family_id",
  "user": {
    "id": "user_uuid",
    "email": "user@example.com",
    "walletAddress": "0x...",
    "role": "listener",
    "twitterUsername": "johndoe"
  }
}
```

### Webhook Events

The backend processes Privy webhooks to keep user data synchronized:

#### `user.created` Webhook

Triggered when a new user signs up via Privy
a

#### `user.updated` Webhook

Triggered when user profile is updated in Privy.

**Backend Action:**

- Update email if changed and verified
- Sync other profile changes

#### `user.linked_account` Webhook

Triggered when user links a new authentication method.

**Payload:**

```json
{
  "user_id": "did:privy:abc123",
  "account_type": "wallet|google|twitter|email|phone",
  "account_address": "0x...",
  "account": {
    // Account-specific data
  }
}
```

**Backend Action:**

- Update wallet address for wallet linking
- Update social profile data for social accounts
- Mark email as verified for email OTP
- Log phone number linking

## Database Schema

Relevant `users` table columns:

```sql
-- Primary identity
privy_user_id VARCHAR UNIQUE  -- did:privy:...

-- Authentication methods
email VARCHAR UNIQUE
email_verified BOOLEAN
wallet_address VARCHAR
password_hash VARCHAR  -- For legacy accounts

-- Social accounts (Issue #610)
twitter_id VARCHAR
twitter_username VARCHAR
twitter_display_name VARCHAR
twitter_profile_image VARCHAR
twitter_verified BOOLEAN
twitter_connected BOOLEAN

facebook_id VARCHAR
facebook_name VARCHAR
facebook_email VARCHAR
facebook_profile_image VARCHAR
facebook_connected BOOLEAN
```

## Security Considerations

### Token Verification

- All Privy tokens use ES256 algorithm
- Tokens are verified against Privy's public keys
- Issuer must be `privy.io`
- Audience must match `PRIVY_APP_ID`

### Account Linking

- Only verified emails can trigger automatic linking
- Wallet addresses must match exactly
- Linking conflicts are detected and prevented
- All linking operations are logged

### Webhook Security

- Webhooks must include valid HMAC-SHA256 signature
- Timestamp checking prevents replay attacks
- Signature comparison uses timing-safe methods

### Rate Limiting

- All auth endpoints are rate-limited
- Webhook endpoints have separate rate limits
- Failed attempts are tracked and throttled

## Configuration

Required environment variables:

```bash
# Privy Core Configuration
PRIVY_APP_ID=your_app_id
PRIVY_APP_SECRET=your_app_secret
PRIVY_JWT_VERIFICATION_KEY=your_verification_key

# Webhook Configuration (Issues #603-#606)
PRIVY_WEBHOOK_SECRET=your_webhook_secret

# Optional
PRIVY_API_URL=https://api.privy.io  # Default
```

## Testing

### Unit Tests

Test coverage includes:

- Token decoding and validation
- Account linking logic (all scenarios)
- Webhook signature verification
- Social account data extraction
- External wallet detection

**Run tests:**

```bash
npm test -- AuthService.test.ts
npm test -- WebhookController.test.ts
```

### Integration Tests

End-to-end flows tested:

1. First-time login with each method
2. Linking additional methods to existing account
3. Switching between authentication methods
4. Webhook processing for each event type

## Usage Examples

### Frontend Integration

```typescript
// Using Privy React SDK
import { usePrivy, useLogin } from '@privy-io/react-auth';

function LoginButton() {
  const { login } = useLogin({
    onComplete: async (user, isNewUser, wasAlreadyAuthenticated) => {
      // Get ID token from Privy
      const idToken = await user.getIdToken();

      // Send to backend
      const response = await fetch('/api/auth/privy/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });

      const { accessToken } = await response.json();
      // Store accessToken for API calls
    }
  });

  return <button onClick={login}>Login</button>;
}
```

### Linking Additional Method

```typescript
// User already logged in, wants to link wallet
const { linkWallet } = useWallets();

await linkWallet();
// Privy handles the wallet connection
// Backend receives user.linked_account webhook
// User's account is automatically updated
```

## Migration Path

For existing users:

1. **Email/Password Users:**
   - Can continue using password login (legacy)
   - Can enable email OTP as alternative
   - Account auto-links when they first use Privy

2. **Wallet Users:**
   - Continue using wallet signatures (legacy)
   - Can link same wallet via Privy
   - Account auto-links on wallet match

3. **New Users:**
   - Recommended to use Privy from start
   - Can choose any supported method
   - Can add methods later without re-registration

## Troubleshooting

### Account Not Linking

**Problem:** User has existing account but new Privy login creates duplicate

**Solution:**

- Check email verification status
- Ensure exact email match (case-insensitive)
- Verify wallet address format
- Check logs for linking conflict

### Social Login Data Missing

**Problem:** Twitter/Google data not appearing in user profile

**Solution:**

- Verify webhook is received
- Check `linked_accounts` array in token
- Ensure webhook signature is valid
- Review webhook processing logs

### External Wallet Not Detected

**Problem:** MetaMask/WalletConnect connection not saving

**Solution:**

- Check `wallet_client` or `connector_type` field
- Verify wallet address in payload
- Ensure webhook endpoint is configured in Privy dashboard

## Related Documentation

- [PRIVY_AUTH.md](./PRIVY_AUTH.md) - Token verification and resilience
- [PRIVY_AUTH_IMPLEMENTATION.md](./PRIVY_AUTH_IMPLEMENTATION.md) - Core implementation
- [PRIVY_MIGRATION_GUIDE.md](./PRIVY_MIGRATION_GUIDE.md) - Migration strategy
- [PRIVY_MFA.md](./PRIVY_MFA.md) - Multi-factor authentication

## Related Issues

- #609: Account linking support (email + wallet)
- #610: Social login providers (Google, Twitter/X)
- #611: SMS/email OTP login
- #613: External wallet connect (MetaMask, WalletConnect)
- #603-#606: Webhook implementation
- #600: First-time user creation
- #615: Role-based access control
