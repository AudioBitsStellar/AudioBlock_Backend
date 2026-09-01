/**
 * Low-level reader around the Soroban RPC `getEvents` / `getLatestLedger`
 * methods. It is intentionally server-injected so it can be unit tested with
 * a mocked RPC client (Issue #233).
 *
 * It normalizes raw `xdr.ScVal` topics/values into native JavaScript shapes
 * so that downstream per-contract decoders only deal with plain values.
 */
import { scValToNative } from '@stellar/stellar-sdk';
import { getSorobanServer } from '../../config/soroban';

/**
 * A contract event normalized to plain JS values, ready to be decoded by a
 * per-contract-type decoder.
 */
export interface NormalizedContractEvent {
  /** RPC event id (used as the idempotency key alongside ledger). */
  id: string;
  /** Ledger sequence in which the event was emitted. */
  ledger: number;
  /** Stellar transaction hash the event belongs to. */
  txHash: string;
  /** Contract id (when known / present on the response). */
  contractId: string | null;
  /** Native-converted topic array (first element is the event symbol). */
  topic: unknown[];
  /** Native-converted event payload (the event `value`). */
  value: unknown;
}

export interface EventsPage {
  events: NormalizedContractEvent[];
  /** Cursor to pass on the next call, or '' when there are no more events. */
  cursor: string;
  /** Latest ledger known to the RPC at the time of the response. */
  latestLedger: number;
}

export interface FetchEventsOptions {
  contractIds: string[];
  /** Cursor-mode pagination. When set, startLedger/endLedger must be omitted. */
  cursor?: string;
  /** Ledger-range mode (used by historical backfill). Mutually exclusive with cursor. */
  startLedger?: number;
  endLedger?: number;
  limit?: number;
}

export interface EventReaderServer {
  getEvents(request: unknown): Promise<{ events: unknown[]; cursor: string; latestLedger: number }>;
  getLatestLedger(): Promise<{ sequence: number }>;
}

function normalizeEvent(raw: unknown): NormalizedContractEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;

  if (typeof e.id !== 'string' || typeof e.ledger !== 'number') return null;

  let topic: unknown[] = [];
  let value: unknown = null;
  try {
    topic = Array.isArray(e.topic) ? e.topic.map((t) => scValToNative(t as never)) : [];
    value = e.value !== undefined ? scValToNative(e.value as never) : null;
  } catch {
    // Some diagnostic events do not deserialize cleanly; treat as unreadable.
    return null;
  }

  return {
    id: e.id,
    ledger: e.ledger,
    txHash: typeof e.txHash === 'string' ? e.txHash : '',
    contractId: typeof e.contractId === 'string' ? e.contractId : null,
    topic,
    value,
  };
}

/**
 * Reader for Soroban contract events.
 *
 * Uses a server injected at construction time (defaulting to the configured
 * Soroban RPC server) so tests can pass a lightweight stub.
 */
export class SorobanEventReader {
  private server: EventReaderServer;

  constructor(server?: EventReaderServer) {
    this.server = server ?? (getSorobanServer() as unknown as EventReaderServer);
  }

  /** Returns the current network ledger tip (latest known sequence). */
  async getLatestLedger(): Promise<number> {
    const resp = await this.server.getLatestLedger();
    return resp.sequence;
  }

  /**
   * Fetch a single page of contract events.
   *
   * - Cursor mode: pass `cursor` to page forward (used by the live poller).
   * - Range mode: pass `startLedger`/`endLedger` (used by historical backfill).
   *
   * Only events from successful contract calls are handed downstream.
   */
  async fetchEvents(opts: FetchEventsOptions): Promise<EventsPage> {
    const { contractIds, cursor, startLedger, endLedger, limit } = opts;

    const request: Record<string, unknown> = {
      filters: [{ type: 'contract', contractIds }],
      limit: limit ?? 200,
    };

    if (cursor) {
      request.cursor = cursor;
    } else {
      request.startLedger = startLedger ?? 1;
      if (endLedger !== undefined) request.endLedger = endLedger;
    }

    const resp = await this.server.getEvents(request);

    const events: NormalizedContractEvent[] = [];
    for (const raw of resp.events) {
      const normalized = normalizeEvent(raw as never);
      if (normalized) events.push(normalized);
    }

    // Preserve the contract on events that may omit it.
    for (const ev of events) {
      if (!ev.contractId && contractIds.length === 1) {
        ev.contractId = contractIds[0];
      }
    }

    return {
      events,
      cursor: resp.cursor ?? '',
      latestLedger: resp.latestLedger,
    };
  }

  /**
   * Fetch every event emitted by a contract across a bounded ledger range.
   *
   * Uses range-mode paging in batches, advancing the start ledger past the
   * highest ledger observed in each page until the range is exhausted. This
   * is what the historical backfill (Issue #235) uses.
   *
   * `onPage` is invoked after each page is fetched so the caller can persist
   * progress incrementally and resume from the last checkpoint.
   */
  async fetchAllInRange(
    contractIds: string[],
    startLedger: number,
    endLedger: number,
    limit = 200,
    onPage?: (page: EventsPage, nextStart: number) => Promise<void> | void,
  ): Promise<EventsPage[]> {
    const pages: EventsPage[] = [];
    let from = startLedger;
    let stalePages = 0;

    while (true) {
      if (from > endLedger) break;

      const page = await this.fetchEvents({
        contractIds,
        startLedger: from,
        endLedger,
        limit,
      });

      pages.push(page);
      const highestLedger = page.events.reduce((max, ev) => Math.max(max, ev.ledger), from - 1);

      const nextFrom = highestLedger >= from ? highestLedger + 1 : from + limit;

      if (onPage) await onPage(page, nextFrom);

      if (highestLedger < from) {
        // No new ledger in this page — avoid an infinite loop.
        stalePages += 1;
        if (stalePages >= 3) break;
      } else {
        stalePages = 0;
      }

      if (nextFrom > endLedger) break;
      from = nextFrom;
    }

    return pages;
  }
}
