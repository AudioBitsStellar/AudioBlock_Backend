# Webhook & Event System Implementation Plan

## Status: NOT YET IMPLEMENTED ⚠️

This document outlines the planned implementation for asynchronous event delivery to frontends. The webhook/event system is currently **not implemented** - frontends must use polling as a temporary workaround.

## Current Workaround (Polling)

Until webhooks are implemented, frontends should:

```typescript
// Poll song status every 5 seconds
const pollMintStatus = async (songId: string) => {
  const interval = setInterval(async () => {
    const res = await fetch(`/api/songs/${songId}`);
    const song = await res.json();

    if (song.mintStatus === "minted" || song.mintStatus === "failed") {
      clearInterval(interval);
      handleMintComplete(song);
    }
  }, 5000);
};
```

## Planned Implementation

### Phase 1: Event Emission (Backend)

Add event emission to `SongService.submitSongMintTx`:

```typescript
// After successful mint
await this.songRepo.save(song);
await this.eventEmitter.emit("mint_status_changed", {
  eventId: generateEventId(),
  eventType: "mint_status_changed",
  timestamp: new Date().toISOString(),
  songId: song.id,
  onChainSongId: song.onChainSongId,
  previousStatus: "minting",
  newStatus: "minted",
  txHash: hash,
  tokenId: song.onChainTokenId,
});
```

### Phase 2: WebSocket Server

```typescript
// src/services/WebSocketService.ts
import { Server } from "socket.io";

export class WebSocketService {
  private io: Server;

  init(httpServer: any) {
    this.io = new Server(httpServer, {
      cors: { origin: process.env.FRONTEND_URLS?.split(",") },
    });

    this.io.on("connection", (socket) => {
      console.log("Client connected:", socket.id);

      socket.on("subscribe", ({ userId }) => {
        socket.join(`user:${userId}`);
      });
    });
  }

  emitMintStatusChanged(userId: string, payload: MintStatusChangedPayload) {
    this.io.to(`user:${userId}`).emit("mint_status_changed", payload);
  }
}
```

### Phase 3: HTTP Webhook Delivery

```typescript
// src/services/WebhookService.ts
export class WebhookService {
  async deliver(endpoint: string, payload: WebhookPayload, authToken: string) {
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
            "X-Webhook-Signature": this.signPayload(payload),
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) return;
      } catch (error) {
        console.error(`Webhook delivery attempt ${attempt + 1} failed:`, error);
      }

      await sleep(2 ** attempt * 1000); // Exponential backoff
    }

    // Store in dead-letter queue after exhausting retries
    await this.deadLetterQueue.add(endpoint, payload);
  }
}
```

### Phase 4: Event Persistence

```typescript
// src/entities/Event.ts
@Entity()
export class Event {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  eventType!: string;

  @Column("jsonb")
  payload!: WebhookPayload;

  @Column()
  userId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ default: false })
  delivered!: boolean;
}
```

## Implementation Timeline

- [ ] **Week 1**: Event emission in SongService and ArtistService
- [ ] **Week 2**: WebSocket server setup with room-based delivery
- [ ] **Week 3**: HTTP webhook delivery with retry logic
- [ ] **Week 4**: Event persistence and replay API
- [ ] **Week 5**: Frontend integration testing with both teams

## Frontend Integration Requirements

Once implemented, frontends must:

1. **Connect to WebSocket on app load**:

   ```typescript
   const socket = io("wss://api.audioblock.com");
   socket.emit("subscribe", { userId: currentUser.id });
   ```

2. **Register webhook endpoint** (optional, for reliability):

   ```typescript
   POST /api/webhooks/register
   {
     "endpoint": "https://dashboard.audioblock.com/api/webhooks/events",
     "authToken": "your-webhook-secret",
     "eventTypes": ["mint_status_changed", "artist_setup_completed"]
   }
   ```

3. **Handle events**:
   ```typescript
   socket.on("mint_status_changed", (event: MintStatusChangedPayload) => {
     updateSongUI(event.songId, event.newStatus);
   });
   ```

## Security Considerations

- **WebSocket authentication**: Require JWT token on connection
- **Webhook signature verification**: Use HMAC-SHA256 for payload signing
- **Rate limiting**: Prevent abuse of subscription endpoints
- **Event replay**: Allow frontends to fetch missed events via REST API

## Open Questions for Frontend Teams

1. **Preferred delivery method**: WebSocket-only, or WebSocket + HTTP webhook?
2. **Reconnection strategy**: Should backend queue events during client disconnects?
3. **Event retention**: How long should events be stored for replay?

Please comment on issue #57 with your preferences.
