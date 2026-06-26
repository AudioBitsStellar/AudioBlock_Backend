/**
 * Webhook and event payload schemas for asynchronous status updates.
 * These payloads define the contract for mint status changes and other
 * async operations that frontends (listener app, artist dashboard) consume.
 */

export enum MintStatus {
  PENDING = "pending",
  MINTING = "minting",
  MINTED = "minted",
  FAILED = "failed",
}

export interface MintStatusChangedPayload {
  /** Unique identifier for the event */
  eventId: string;

  /** Event type discriminator */
  eventType: "mint_status_changed";

  /** ISO 8601 timestamp when the event occurred */
  timestamp: string;

  /** Internal song identifier */
  songId: string;

  /** On-chain song ID (if minted) */
  onChainSongId?: string;

  /** Previous mint status before this change */
  previousStatus: MintStatus;

  /** New mint status after this change */
  newStatus: MintStatus;

  /** Stellar transaction hash (if status is minted or failed) */
  txHash?: string;

  /** On-chain token ID (if minted successfully) */
  tokenId?: string;

  /** Error code if status is failed */
  errorCode?: string;

  /** Human-readable error message if status is failed */
  errorMessage?: string;
}

export interface ArtistSetupCompletedPayload {
  eventId: string;
  eventType: "artist_setup_completed";
  timestamp: string;
  userId: string;
  txHash: string;
  artistId: string;
  tokenId: string;
}

export interface SongProcessingCompletedPayload {
  eventId: string;
  eventType: "song_processing_completed";
  timestamp: string;
  songId: string;
  status: "ready" | "failed";
  hlsMasterUrl?: string;
  metadataCid?: string;
  errorMessage?: string;
}

/**
 * Union type of all possible webhook payloads for type discrimination.
 */
export type WebhookPayload =
  | MintStatusChangedPayload
  | ArtistSetupCompletedPayload
  | SongProcessingCompletedPayload;

/**
 * Delivery method configuration for webhook payloads.
 * Frontends can subscribe via WebSocket/SSE for real-time updates
 * or register an HTTP webhook endpoint for reliable delivery.
 */
export interface WebhookDeliveryConfig {
  /** Delivery method: websocket, sse, or http */
  method: "websocket" | "sse" | "http";

  /** Target endpoint for HTTP webhooks */
  endpoint?: string;

  /** Authentication token for HTTP webhooks */
  authToken?: string;

  /** Event types to subscribe to */
  eventTypes: string[];
}
