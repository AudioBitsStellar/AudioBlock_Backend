import { EntityManager } from 'typeorm';
import { IndexedEvent } from '../../entities/IndexedEvent';
import { EventProjection } from './EventProjection';

const UNKNOWN_CONTRACT_TYPE = 'unknown';

interface CountRow {
  network: string;
  contractType: string;
  eventType: string;
  count: number;
}

/**
 * Maintains `onchain_event_counts`: number of raw events per
 * (network, contractType, eventType) (Issue #261).
 */
export class OnChainEventCountProjection implements EventProjection {
  readonly name = 'onchain_event_counts';

  async reset(manager: EntityManager): Promise<void> {
    // DELETE (not TRUNCATE) so concurrent readers keep seeing the old counts
    // until the rebuild transaction commits.
    await manager.query('DELETE FROM "onchain_event_counts"');
  }

  async apply(events: IndexedEvent[], manager: EntityManager): Promise<void> {
    const totals = new Map<string, CountRow>();
    for (const event of events) {
      const contractType = event.contractType || UNKNOWN_CONTRACT_TYPE;
      const key = `${event.network}\u0000${contractType}\u0000${event.eventType}`;
      const entry = totals.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        totals.set(key, {
          network: event.network,
          contractType,
          eventType: event.eventType,
          count: 1,
        });
      }
    }
    if (totals.size === 0) return;

    const rows = [...totals.values()];
    await manager.query(
      `INSERT INTO "onchain_event_counts" ("network", "contractType", "eventType", "count")
       SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::varchar[], $4::bigint[])
       ON CONFLICT ("network", "contractType", "eventType")
       DO UPDATE SET "count" = "onchain_event_counts"."count" + EXCLUDED."count", "updatedAt" = now()`,
      [
        rows.map((r) => r.network),
        rows.map((r) => r.contractType),
        rows.map((r) => r.eventType),
        rows.map((r) => r.count),
      ],
    );
  }
}
