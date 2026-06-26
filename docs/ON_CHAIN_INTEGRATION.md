# On-Chain Integration Guide

This document defines the contract between the AudioBlock backend and frontend applications (listener app, artist dashboard) for on-chain transaction flows.

## Table of Contents

1. [Transaction Preparation & Time Bounds](#transaction-preparation--time-bounds)
2. [Error Handling Contract](#error-handling-contract)
3. [Wallet Connection Flow](#wallet-connection-flow)
4. [Webhook & Event Payloads](#webhook--event-payloads)

---

## Transaction Preparation & Time Bounds

### Overview

The backend builds unsigned Soroban transactions that artists sign via their wallet (Freighter). Transaction validity is time-sensitive and must account for user signing delays.

### Current Implementation

**SorobanService** (`src/services/Soroban/SorobanService.ts`) prepares transactions with:

```typescript
.setTimeout(120) // 120 seconds = 2 minutes
```

This sets the transaction's `timeBounds.maxTime` to 120 seconds from preparation.

### Time-Bound Coordination

**Frontend Responsibilities:**

1. **Display a timer**: Show users remaining time (e.g., "1:45 remaining to sign")
2. **Handle expiration gracefully**: If user signs after expiration, backend returns:
   ```json
   {
     "success": false,
     "errorCode": "TRANSACTION_EXPIRED",
     "message": "Transaction has expired. Please retry to generate a fresh transaction.",
     "retryable": true
   }
   ```
3. **Retry flow**: When `errorCode === "TRANSACTION_EXPIRED"`, re-fetch unsigned XDR from `/prepare-*` endpoint

**Backend Guarantees:**

- 120-second window for all prepared transactions
- Sequence numbers remain valid during this window (unless account makes another transaction externally)
- Expired transaction submissions return `TRANSACTION_EXPIRED` error code

**Recommended Frontend Flow:**

```
1. Call /api/artist/onchain/prepare-setup
2. Display Freighter prompt with countdown (2:00 remaining)
3. User signs in wallet
4. Submit to /api/artist/onchain/submit-setup
5. If TRANSACTION_EXPIRED error: go back to step 1
```

---

## Error Handling Contract

### Error Response Format

All on-chain relay endpoints (`/onchain/submit-setup`, `/songs/:id/mint/submit`) return standardized errors:

```typescript
{
  success: false,
  errorCode: string,      // enum value from OnChainErrorCode
  message: string,        // human-readable message
  retryable: boolean,     // whether user should retry
  details?: unknown       // optional technical details
}
```

### Error Codes

See `src/types/OnChainErrorCodes.ts` for full enum. Key codes:

| Error Code                      | Description                    | Retryable | Frontend Action                    |
| ------------------------------- | ------------------------------ | --------- | ---------------------------------- |
| `TRANSACTION_EXPIRED`           | User took too long to sign     | Yes       | Re-fetch unsigned XDR              |
| `TRANSACTION_INVALID_SIGNATURE` | Signature verification failed  | Yes       | Prompt user to sign again          |
| `TRANSACTION_SEQUENCE_MISMATCH` | Account sequence out of sync   | Yes       | Retry (backend refreshes sequence) |
| `SOROBAN_NETWORK_ERROR`         | Stellar network unavailable    | Yes       | Show "Network issue, retry"        |
| `SOROBAN_TIMEOUT`               | Network request timed out      | Yes       | Retry with backoff                 |
| `CONTRACT_INVOCATION_FAILED`    | Smart contract rejected call   | No        | Show error, contact support        |
| `WALLET_NOT_CONNECTED`          | No Stellar wallet linked       | No        | Redirect to wallet connect         |
| `METADATA_NOT_READY`            | Song metadata not uploaded yet | No        | Wait for processing                |
| `INVALID_XDR_FORMAT`            | Malformed transaction          | Yes       | Restart flow                       |
| `UNKNOWN_ERROR`                 | Unexpected failure             | Yes       | Generic retry prompt               |

### Frontend Integration

**React Example:**

```typescript
async function submitSetup(signedXdr: string) {
  const res = await fetch("/api/artist/onchain/submit-setup", {
    method: "POST",
    body: JSON.stringify({ signedXdr }),
    headers: { "Content-Type": "application/json" },
  });

  const data = await res.json();

  if (!data.success) {
    switch (data.errorCode) {
      case "TRANSACTION_EXPIRED":
        // Re-fetch unsigned transaction
        return retryPrepareSetup();

      case "WALLET_NOT_CONNECTED":
        // Redirect to wallet connection
        return navigate("/connect-wallet");

      case "CONTRACT_INVOCATION_FAILED":
        // Fatal error
        return showError("Setup failed. Please contact support.");

      default:
        if (data.retryable) {
          return showRetryButton();
        } else {
          return showError(data.message);
        }
    }
  }

  // Success path
  handleSuccess(data.data);
}
```

---

## Wallet Connection Flow

### Endpoint

`POST /api/artist/onchain/connect-wallet`

### Request Payload

See `src/dtos/ConnectStellarWalletDTO.ts`:

```typescript
{
  stellarPublicKey: string; // Must match regex: ^G[A-Z2-7]{55}$
}
```

### Frontend Integration Points

**Artist Dashboard Requirements:**

1. Integrate Freighter wallet SDK: `@stellar/freighter-api`
2. Request user's public key: `await freighter.getPublicKey()`
3. Send public key to backend: `POST /api/artist/onchain/connect-wallet`
4. Store connection status in UI state

**No Signature Challenge Required:**

The current implementation does NOT require a signed challenge for wallet connection. The backend simply records the public key. Future iterations may add signature verification.

**Example Integration:**

```typescript
import { isConnected, getPublicKey } from "@stellar/freighter-api";

async function connectWallet() {
  if (!(await isConnected())) {
    alert("Please install Freighter wallet");
    return;
  }

  const publicKey = await getPublicKey();

  const res = await fetch("/api/artist/onchain/connect-wallet", {
    method: "POST",
    body: JSON.stringify({ stellarPublicKey: publicKey }),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (res.ok) {
    console.log("Wallet connected:", publicKey);
  }
}
```

### Contract Test Fixture

See `tests/fixtures/walletConnection.fixture.ts` (to be created by frontend team):

```typescript
// Both backend and frontend can reference this fixture
export const validWalletConnection = {
  stellarPublicKey: "GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
};

export const invalidWalletConnections = [
  { stellarPublicKey: "invalid" }, // Wrong format
  { stellarPublicKey: "MXXXXXXX" }, // M-address (secret key)
  { stellarPublicKey: "" }, // Empty
];
```

---

## Webhook & Event Payloads

### Overview

Asynchronous operations (song minting, artist setup) emit events that frontends consume via WebSocket, SSE, or HTTP webhooks.

### Mint Status Changed Event

See `src/types/WebhookPayloads.ts` for full schema.

**Payload:**

```typescript
{
  eventId: string,           // Unique event identifier
  eventType: "mint_status_changed",
  timestamp: string,         // ISO 8601 format
  songId: string,            // Internal song ID
  onChainSongId?: string,    // On-chain song ID (if minted)
  previousStatus: "pending" | "minting" | "minted" | "failed",
  newStatus: "pending" | "minting" | "minted" | "failed",
  txHash?: string,           // Stellar tx hash (if minted/failed)
  tokenId?: string,          // NFT token ID (if minted)
  errorCode?: string,        // OnChainErrorCode (if failed)
  errorMessage?: string      // Human-readable error (if failed)
}
```

**Example Success Event:**

```json
{
  "eventId": "evt_abc123",
  "eventType": "mint_status_changed",
  "timestamp": "2026-06-26T10:30:00Z",
  "songId": "song_xyz",
  "onChainSongId": "42",
  "previousStatus": "minting",
  "newStatus": "minted",
  "txHash": "a1b2c3d4e5f6...",
  "tokenId": "1337"
}
```

**Example Failure Event:**

```json
{
  "eventId": "evt_def456",
  "eventType": "mint_status_changed",
  "timestamp": "2026-06-26T10:31:00Z",
  "songId": "song_xyz",
  "previousStatus": "minting",
  "newStatus": "failed",
  "txHash": "x9y8z7...",
  "errorCode": "CONTRACT_INVOCATION_FAILED",
  "errorMessage": "Insufficient balance for minting fee"
}
```

### Delivery Methods

**Option 1: WebSocket (Recommended for real-time UX)**

```typescript
const ws = new WebSocket("wss://api.audioblock.com/events");

ws.on("message", (data) => {
  const event = JSON.parse(data);
  if (event.eventType === "mint_status_changed") {
    updateSongStatus(event.songId, event.newStatus);
  }
});
```

**Option 2: HTTP Webhook**

Frontends register an endpoint:

```
POST https://dashboard.audioblock.com/api/webhooks/mint-status
Authorization: Bearer <webhook_secret>
Content-Type: application/json

{
  "eventId": "evt_abc123",
  "eventType": "mint_status_changed",
  ...
}
```

### Frontend Responsibilities

1. **Subscribe to events**: Connect to WebSocket or register webhook endpoint
2. **Update UI in real-time**: Reflect status changes without polling
3. **Handle failures**: Display error from `errorCode` and `errorMessage`
4. **Poll as fallback**: If WebSocket disconnects, fall back to polling `/songs/:id`

### Backend Status (To Be Implemented)

- [ ] WebSocket server for event streaming
- [ ] Webhook delivery system with retry logic
- [ ] Event persistence for replay

**Current Workaround:** Frontends must poll `/songs/:id` to check `mintStatus` field.

---

## Frontend Team Sign-Off

This document requires approval from:

- [ ] **Listener App Team**: Confirm event payload schema meets requirements
- [ ] **Artist Dashboard Team**: Confirm wallet connection flow and error handling
- [ ] **Backend Team**: Confirm implementation matches documentation

Please comment on GitHub issues #57, #58, #59, #60 with sign-off or requested changes.
