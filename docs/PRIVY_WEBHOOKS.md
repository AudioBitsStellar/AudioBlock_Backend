# Privy Webhooks Implementation

**Status:** Implemented (Issues #603-#606, #612, #614)
**Related:** [Privy Authentication](./PRIVY_AUTH.md), [Account Types](./ACCOUNT_TYPES.md)

## Overview

AudioBlock integrates with Privy webhooks to receive real-time notifications about user account lifecycle events. This enables:

- Embedded wallet creation on signup (Issue #612)
- Stellar wallet linking (Issue #614)
- Profile synchronization
- Account updates from Privy dashboard

## Webhook Events

### Supported Events

#### 1. `user.created` (Issue #612)

Fired when a new user signs up via Privy.

**Use Case:** Create local user account and link Privy identity

**Payload Example:**

````json
{
  "type": "user.created",
  "data": {

   - `privyUserId` = `data.user.id`
   - `email` = `data.user.email.address`
   - `walletAddress` = embedded wallet address
   - `role` = `listener` (default)
3. Mark email as verified if provided by Privy
4. Log creation event

#### 2. `user.updated`

Fired when user profile is updated in Privy dashboard.

**Use Case:** Sync profile changes to local database

**Payload Example:**
```json
{
  "type": "user.updated",
  "data": {
    "user": {
      "id": "did:privy:abc123",
      "email": {
        "address": "newemail@example.com"
      }
    }
  }
}
````

**Backend Actions:**

1. Find user by `privyUserId`
2. Update changed fields (email, verified status)
3. Skip if user not found (non-critical)

#### 3. `user.linked_account` (Issue #614)

Fired when user links an external wallet or social account.

**Use Case:** Connect Stellar wallets, Twitter, Google, etc.

**Payload Example (Stellar Wallet):**

```json
{
  "type": "user.linked_account",
  "data": {
    "user_id": "did:privy:abc123",
    "linked_account": {
      "type": "wallet",
      "address": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHYFN",
      "chain_type": "stellar"
    }
  }
}
```

**Payload Example (Twitter):**

```json
{
  "type": "user.linked_account",
  "data": {
    "user_id": "did:privy:abc123",
    "linked_account": {
      "type": "twitter_oauth",
      "username": "cool_user",
      "name": "Cool User",
      "profile_picture_url": "https://...",
      "verified": false
    }
  }
}
```

**Backend Actions:**

1. Find user by `privyUserId`
2. Detect account type (wallet, social)
3. For Stellar wallets (chain_type=stellar or address starts with 'G'):
   - Update `stellarPublicKey` field
4. For other wallets:
   - Update `walletAddress` field
5. For Twitter:
   - Update Twitter profile fields
6. For Google:
   - Update email if not already set

## Webhook Signature Verification (Issue #606)

All webhooks are verified using HMAC-SHA256 signatures to ensure authenticity.

### Signature Format

```
privy-signature: t=<timestamp>,v1=<signature>
```

### Verification Process

```typescript
import crypto from 'crypto';

const signature = req.headers['privy-signature'];
const parts = signature.split(',');
const timestamp = parseInt(parts.find((p) => p.startsWith('t=')).split('=')[1]);
const expectedSignature = parts.find((p) => p.startsWith('v1=')).split('=')[1];

// Check timestamp (5 minute tolerance)
const currentTime = Math.floor(Date.now() / 1000);
if (Math.abs(currentTime - timestamp) > 300) {
  throw new Error('Webhook timestamp expired');
}

// Compute signature
const payload = JSON.stringify(req.body);
const signedPayload = `${timestamp}.${payload}`;
const computedSignature = crypto
  .createHmac('sha256', PRIVY_APP_SECRET)
  .update(signedPayload)
  .digest('hex');

// Constant-time comparison
if (!crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(computedSignature))) {
  throw new Error('Invalid signature');
}
```

### Security Measures

1. **Timestamp Validation**
   - 5-minute tolerance window
   - Prevents replay attacks
   - Rejects stale webhooks

2. **HMAC Verification**
   - Uses `PRIVY_APP_SECRET`
   - Ensures payload integrity
   - Detects tampering

3. **Constant-Time Comparison**
   - Prevents timing attacks
   - Uses `crypto.timingSafeEqual()`

## Webhook Endpoint

### Route Configuration

```typescript
POST / api / webhooks / privy;
```

**Middleware Stack:**

1. `verifyPrivyWebhookSignature` - Signature validation
2. `PrivyWebhookController.handleWebhook` - Event processing

### Request Headers

```
Content-Type: application/json
privy-signature: t=1234567890,v1=abc123...
```

### Response

**Success (200 OK):**

```json
{
  "success": true,
  "received": true
}
```

**Error (4xx/5xx):**

```json
{
  "message": "Error description",
  "details": {...}
}
```

## Implementation Details

### Controller: `PrivyWebhookController`

Located in `src/controllers/PrivyWebhookController.ts`

**Responsibilities:**

- Route webhook events to appropriate handlers
- Create/update local user records
- Sync profile data
- Link wallets and social accounts
- Log all webhook activity

**Key Methods:**

```typescript
class PrivyWebhookController {
  // Main webhook entry point
  handleWebhook(req: Request, res: Response): Promise<void>;

  // Handle new user signups
  private handleUserCreated(event: any): Promise<void>;

  // Handle profile updates
  private handleUserUpdated(event: any): Promise<void>;

  // Handle account linking (wallets, social)
  private handleLinkedAccount(event: any): Promise<void>;
}
```

### Middleware: `verifyPrivyWebhookSignature`

Located in `src/middlewares/privyWebhookMiddleware.ts`

**Security Features:**

- HMAC-SHA256 signature verification
- Timestamp-based replay protection
- Constant-time comparison
- Detailed error logging

### Service Integration

Webhooks interact with:

- `UserService` - User CRUD operations
- `PrivyUserResolver` - Privy identity resolution
- `AccountTypeService` - Role management (Issue #616)

## Configuration

### Environment Variables

```bash
# Required for webhook signature verification
PRIVY_APP_SECRET=your_app_secret_here

# Required for user account linking
PRIVY_APP_ID=your_app_id_here
```

### Privy Dashboard Setup

1. Navigate to Privy Dashboard → Webhooks
2. Add webhook URL: `https://your-domain.com/api/webhooks/privy`
3. Select events to subscribe:
   - ✅ user.created
   - ✅ user.updated
   - ✅ user.linked_account
4. Save configuration
5. Copy webhook secret to `PRIVY_APP_SECRET`

## Error Handling

### Webhook Processing Failures

Webhooks that fail processing are logged but do not block the response:

```typescript
try {
  await processWebhook(event);
} catch (error) {
  logger.error({ err: error, event }, 'Webhook processing failed');
  // Return 200 to prevent Privy retries
  res.status(200).json({ success: true, received: true });
}
```

### Retry Strategy

Privy automatically retries failed webhooks (non-2xx responses):

- Initial retry: 1 minute
- Subsequent retries: Exponential backoff
- Maximum retries: 10 attempts
- Timeout: 24 hours

**Best Practice:** Return 200 OK even for non-critical errors to prevent unnecessary retries.

## Monitoring

### Logging

All webhook events are logged with:

```typescript
logger.info(
  {
    eventType,
    privyUserId,
    timestamp,
    action: 'created' | 'updated' | 'linked',
  },
  'Processed Privy webhook',
);
```

### Metrics (Recommended)

Track these metrics for webhook health:

- `privy_webhooks_received_total{event_type}`
- `privy_webhooks_processed_total{event_type, status}`
- `privy_webhooks_processing_duration_seconds{event_type}`
- `privy_webhook_signature_failures_total`

## Testing

### Local Testing with Webhook Forwarding

Use a tool like `ngrok` or `localtunnel` to forward webhooks to local development:

```bash
# Start ngrok
ngrok http 3000

# Update Privy webhook URL to ngrok URL
https://abc123.ngrok.io/api/webhooks/privy
```

### Manual Webhook Testing

Send test webhooks using curl:

```bash
TIMESTAMP=$(date +%s)
PAYLOAD='{"type":"user.created","data":{"user":{"id":"did:privy:test123"}}}'
SIGNATURE=$(echo -n "${TIMESTAMP}.${PAYLOAD}" | openssl dgst -sha256 -hmac "$PRIVY_APP_SECRET" | cut -d' ' -f2)

curl -X POST http://localhost:3000/api/webhooks/privy \
  -H "Content-Type: application/json" \
  -H "privy-signature: t=${TIMESTAMP},v1=${SIGNATURE}" \
  -d "$PAYLOAD"
```

### Integration Tests

See `src/__tests__/PrivyWebhook.test.ts`:

- Signature verification
- Event routing
- User creation
- Account linking
- Error handling

## Troubleshooting

### Signature Verification Failed

**Problem:** Webhooks rejected with "Invalid webhook signature"

**Solutions:**

1. Verify `PRIVY_APP_SECRET` matches Privy dashboard
2. Check webhook URL is correct (no trailing slash)
3. Ensure timestamp tolerance (5 min) isn't exceeded
4. Verify payload hasn't been modified in transit

### User Not Created

**Problem:** Webhook received but user not in database

**Solutions:**

1. Check logs for error details
2. Verify `privyUserId` format (starts with `did:privy:`)
3. Ensure database connection is healthy
4. Check for validation errors on user fields

### Duplicate Webhooks

**Problem:** Same event received multiple times

**Solutions:**

1. Implement idempotency check on `privyUserId`
2. Log webhook `event_id` if provided
3. Return 200 OK for already-processed events
4. Check Privy dashboard for retry configuration

### Stellar Wallet Not Linked

**Problem:** Linked account webhook received but `stellarPublicKey` not set

**Solutions:**

1. Verify chain_type is "stellar"
2. Check address format (starts with 'G')
3. Ensure user exists before linking
4. Check for field validation errors

## Security Best Practices

1. **Always Verify Signatures**
   - Never process unverified webhooks
   - Use constant-time comparison
   - Reject expired timestamps

2. **Validate Payload Structure**
   - Check required fields exist
   - Validate data types
   - Sanitize user input

3. **Rate Limiting**
   - Monitor webhook frequency
   - Implement rate limits if needed
   - Alert on suspicious patterns

4. **Audit Logging**
   - Log all webhook events
   - Include IP address
   - Track processing outcomes

5. **Secret Management**
   - Store `PRIVY_APP_SECRET` securely
   - Rotate periodically
   - Never log or expose in errors

## Related Documentation

- [Privy Authentication](./PRIVY_AUTH.md)
- [Account Types (Issue #616)](./ACCOUNT_TYPES.md)
- [Stellar Integration (Issue #614)](./ON_CHAIN_INTEGRATION.md)
- [RBAC Implementation (Issue #615)](./RBAC.md)

## References

- [Privy Webhook Documentation](https://docs.privy.io/guide/webhooks)
- [HMAC Signature Verification](https://docs.privy.io/guide/webhooks#verifying-webhook-signatures)
- [Webhook Event Reference](https://docs.privy.io/guide/webhooks#events)
