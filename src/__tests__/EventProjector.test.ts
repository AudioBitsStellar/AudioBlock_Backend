/**
 * Tests for decoupled event ingestion / projection (Issue #261).
 */
import 'reflect-metadata';
import { DataSource, EntityManager, FindOperator } from 'typeorm';
import { EventProjector } from '../services/EventProjector';
import { EventProjection } from '../services/projections/EventProjection';
import { OnChainEventCountProjection } from '../services/projections/OnChainEventCountProjection';
import { IndexedEvent } from '../entities/IndexedEvent';
import { ProjectionCheckpoint } from '../entities/ProjectionCheckpoint';
import { parseArgs, runProjections } from '../cli/project';
import { startProjectorLoop } from '../workers/indexer';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { isInitialized: true, initialize: jest.fn(), transaction: jest.fn() },
}));
jest.mock('../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

/** In-memory stand-in for the raw table, the checkpoint table and a transaction. */
function createFakeStore() {
  const events: IndexedEvent[] = [];
  const checkpoints = new Map<string, ProjectionCheckpoint>();
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  let seq = 0;

  const eventRepo = {
    find: jest.fn(async (opts: { where: Record<string, FindOperator<unknown>>; take: number }) => {
      const after = BigInt(opts.where.ingestSeq.value as string);
      const cutoff = opts.where.indexedAt.value as Date;
      return events
        .filter((e) => BigInt(e.ingestSeq) > after && e.indexedAt <= cutoff)
        .sort((a, b) => Number(BigInt(a.ingestSeq) - BigInt(b.ingestSeq)))
        .slice(0, opts.take);
    }),
  };
  const checkpointRepo = {
    findOne: jest.fn(async ({ where }: { where: { projection: string } }) => {
      const cp = checkpoints.get(where.projection);
      return cp ? { ...cp } : null;
    }),
    create: jest.fn((dto: Partial<ProjectionCheckpoint>) => ({ ...dto }) as ProjectionCheckpoint),
    save: jest.fn(async (cp: ProjectionCheckpoint) => {
      checkpoints.set(cp.projection, { ...cp });
      return cp;
    }),
  };

  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === IndexedEvent) return eventRepo;
      if (entity === ProjectionCheckpoint) return checkpointRepo;
      throw new Error('unexpected repository');
    }),
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return [];
    }),
  } as unknown as EntityManager;

  const dataSource = {
    transaction: jest.fn(async (cb: (m: EntityManager) => Promise<unknown>) => cb(manager)),
  } as unknown as DataSource;

  /** Simulates ingestion: append a raw row, as IndexedEventService does. */
  function ingest(partial: Partial<IndexedEvent>, indexedAt = new Date(Date.now() - 60_000)) {
    seq += 1;
    events.push({
      id: `evt-${seq}`,
      ingestSeq: String(seq),
      network: 'testnet',
      contractType: 'marketplace',
      eventType: 'sale',
      indexedAt,
      ...partial,
    } as IndexedEvent);
  }

  return { events, checkpoints, queries, dataSource, manager, ingest };
}

/** Deterministic projection that counts events per eventType in memory. */
class CountingProjection implements EventProjection {
  readonly name = 'test_counts';
  counts = new Map<string, number>();
  weight = 1;
  resets = 0;

  async reset(): Promise<void> {
    this.resets += 1;
    this.counts.clear();
  }

  async apply(events: IndexedEvent[]): Promise<void> {
    for (const e of events) {
      this.counts.set(e.eventType, (this.counts.get(e.eventType) ?? 0) + this.weight);
    }
  }
}

describe('EventProjector (Issue #261)', () => {
  it('applies raw events incrementally and advances the checkpoint', async () => {
    const store = createFakeStore();
    const projection = new CountingProjection();
    const projector = new EventProjector({
      projections: [projection],
      batchSize: 2,
      settleMs: 0,
      dataSource: store.dataSource,
    });

    store.ingest({ eventType: 'sale' });
    store.ingest({ eventType: 'sale' });
    store.ingest({ eventType: 'mint' });

    const [first] = await projector.catchUp();
    expect(first).toMatchObject({ eventsApplied: 3, lastIngestSeq: '3', rebuilt: false });
    expect(projection.counts.get('sale')).toBe(2);
    expect(projection.counts.get('mint')).toBe(1);

    // No new raw events: nothing re-applied.
    const [second] = await projector.catchUp();
    expect(second).toMatchObject({ eventsApplied: 0, lastIngestSeq: '3' });
    expect(projection.counts.get('sale')).toBe(2);

    store.ingest({ eventType: 'sale' });
    const [third] = await projector.catchUp();
    expect(third).toMatchObject({ eventsApplied: 1, lastIngestSeq: '4' });
    expect(projection.counts.get('sale')).toBe(3);
    expect(store.checkpoints.get('test_counts')).toMatchObject({
      lastIngestSeq: '4',
      eventsApplied: '4',
    });
  });

  it('rebuilds from scratch against existing raw events after a logic fix', async () => {
    const store = createFakeStore();
    const projection = new CountingProjection();
    const projector = new EventProjector({
      projections: [projection],
      batchSize: 2,
      settleMs: 0,
      dataSource: store.dataSource,
    });

    for (let i = 0; i < 5; i++) store.ingest({ eventType: 'sale' });

    // Buggy projection logic double-counts.
    projection.weight = 2;
    await projector.catchUp();
    expect(projection.counts.get('sale')).toBe(10);

    // Fix the bug, then rebuild: raw rows are replayed, not re-ingested.
    projection.weight = 1;
    const [result] = await projector.rebuild();

    expect(result).toMatchObject({ eventsApplied: 5, lastIngestSeq: '5', rebuilt: true });
    expect(projection.resets).toBe(1);
    expect(projection.counts.get('sale')).toBe(5);
    expect(store.events).toHaveLength(5);
    expect(store.checkpoints.get('test_counts')?.lastRebuiltAt).toBeInstanceOf(Date);
  });

  it('rebuild with no raw events still resets the checkpoint', async () => {
    const store = createFakeStore();
    store.checkpoints.set('test_counts', {
      projection: 'test_counts',
      lastIngestSeq: '42',
      eventsApplied: '42',
      lastRebuiltAt: null,
    } as ProjectionCheckpoint);
    const projector = new EventProjector({
      projections: [new CountingProjection()],
      settleMs: 0,
      dataSource: store.dataSource,
    });

    const [result] = await projector.rebuild('test_counts');

    expect(result).toMatchObject({ eventsApplied: 0, lastIngestSeq: '0' });
    expect(store.checkpoints.get('test_counts')).toMatchObject({
      lastIngestSeq: '0',
      eventsApplied: '0',
    });
  });

  it('does not project raw events that have not settled yet', async () => {
    const store = createFakeStore();
    const projection = new CountingProjection();
    const projector = new EventProjector({
      projections: [projection],
      settleMs: 5_000,
      dataSource: store.dataSource,
    });

    store.ingest({ eventType: 'sale' });
    store.ingest({ eventType: 'sale' }, new Date());

    const [result] = await projector.catchUp();
    expect(result).toMatchObject({ eventsApplied: 1, lastIngestSeq: '1' });
  });

  it('takes a per-projection advisory lock inside each transaction', async () => {
    const store = createFakeStore();
    const projector = new EventProjector({
      projections: [new CountingProjection()],
      settleMs: 0,
      dataSource: store.dataSource,
    });

    await projector.catchUp();

    expect(store.queries[0]).toEqual({
      sql: 'SELECT pg_advisory_xact_lock(hashtext($1))',
      params: ['indexer_projection:test_counts'],
    });
  });

  it('rejects unknown projection names', async () => {
    const store = createFakeStore();
    const projector = new EventProjector({
      projections: [new CountingProjection()],
      dataSource: store.dataSource,
    });
    await expect(projector.rebuild('nope')).rejects.toThrow('Unknown projection "nope"');
  });
});

describe('OnChainEventCountProjection', () => {
  it('aggregates a batch into a single additive upsert', async () => {
    const store = createFakeStore();
    const projection = new OnChainEventCountProjection();
    const events = [
      { network: 'testnet', contractType: 'marketplace', eventType: 'sale' },
      { network: 'testnet', contractType: 'marketplace', eventType: 'sale' },
      { network: 'mainnet', contractType: undefined, eventType: 'mint' },
    ] as IndexedEvent[];

    await projection.apply(events, store.manager);

    expect(store.queries).toHaveLength(1);
    expect(store.queries[0].sql).toContain('ON CONFLICT');
    expect(store.queries[0].params).toEqual([
      ['testnet', 'mainnet'],
      ['marketplace', 'unknown'],
      ['sale', 'mint'],
      [2, 1],
    ]);
  });

  it('skips the write for an empty batch and deletes rows on reset', async () => {
    const store = createFakeStore();
    const projection = new OnChainEventCountProjection();

    await projection.apply([], store.manager);
    expect(store.queries).toHaveLength(0);

    await projection.reset(store.manager);
    expect(store.queries).toEqual([
      { sql: 'DELETE FROM "onchain_event_counts"', params: undefined },
    ]);
  });
});

describe('Projection CLI', () => {
  it('parses flags', () => {
    expect(parseArgs([])).toEqual({ rebuild: false });
    expect(parseArgs(['--rebuild', '--projection', 'onchain_event_counts'])).toEqual({
      rebuild: true,
      projection: 'onchain_event_counts',
    });
    expect(parseArgs(['--help'])).toBeNull();
    expect(parseArgs(['--bogus'])).toBeNull();
  });

  it('dispatches to rebuild or catchUp', async () => {
    const projector = {
      rebuild: jest.fn().mockResolvedValue([]),
      catchUp: jest.fn().mockResolvedValue([]),
    } as unknown as EventProjector;

    await runProjections({ rebuild: true, projection: 'x' }, projector);
    await runProjections({ rebuild: false }, projector);

    expect(projector.rebuild).toHaveBeenCalledWith('x');
    expect(projector.catchUp).toHaveBeenCalledWith(undefined);
  });
});

describe('startProjectorLoop', () => {
  it('runs catch-up independently and survives projector failures', async () => {
    jest.useFakeTimers();
    const projector = {
      catchUp: jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]),
    } as unknown as EventProjector;

    const timer = startProjectorLoop(projector, 1000);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1000);
    clearInterval(timer);
    jest.useRealTimers();

    expect(projector.catchUp).toHaveBeenCalledTimes(2);
  });
});
