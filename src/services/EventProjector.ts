/**
 * Event projector (Issue #261).
 *
 * Ingestion (IndexerWorker, BackfillService, reindex CLI) only writes raw rows
 * to `indexed_events`. This projector is the separate step that turns those
 * raw rows into derived read models, tracking its position per projection in
 * `indexer_projection_checkpoints`.
 *
 * - `catchUp()` applies raw events newer than the checkpoint, in `ingestSeq`
 *   order. Each batch and its checkpoint advance commit in one transaction, so
 *   an event is applied exactly once.
 * - `rebuild()` resets a projection and replays every raw event from scratch
 *   in a single transaction, so readers never observe a half-built model.
 *
 * A Postgres advisory lock per projection keeps concurrent catch-up/rebuild
 * runs (worker loop + CLI) from interleaving.
 */
import { DataSource, EntityManager, LessThanOrEqual, MoreThan } from 'typeorm';
import AppDataSource from '../config/db';
import logger from '../config/logger';
import { IndexedEvent } from '../entities/IndexedEvent';
import { ProjectionCheckpoint } from '../entities/ProjectionCheckpoint';
import { EventProjection } from './projections/EventProjection';
import { OnChainEventCountProjection } from './projections/OnChainEventCountProjection';

const DEFAULT_BATCH_SIZE = parseInt(process.env.INDEXER_PROJECTOR_BATCH_SIZE || '500', 10);
/**
 * Only project rows older than this. `ingestSeq` values are allocated before
 * commit, so a lower sequence can become visible after a higher one; waiting
 * for rows to settle keeps the checkpoint from skipping past them.
 */
const DEFAULT_SETTLE_MS = parseInt(process.env.INDEXER_PROJECTOR_SETTLE_MS || '5000', 10);

export interface ProjectorOptions {
  projections?: EventProjection[];
  batchSize?: number;
  settleMs?: number;
  dataSource?: DataSource;
}

export interface ProjectionRunResult {
  projection: string;
  eventsApplied: number;
  lastIngestSeq: string;
  rebuilt: boolean;
}

export function defaultProjections(): EventProjection[] {
  return [new OnChainEventCountProjection()];
}

export class EventProjector {
  private projections: EventProjection[];
  private batchSize: number;
  private settleMs: number;
  private dataSource: DataSource;

  constructor(options: ProjectorOptions = {}) {
    this.projections = options.projections ?? defaultProjections();
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    this.dataSource = options.dataSource ?? AppDataSource;
  }

  listProjections(): string[] {
    return this.projections.map((p) => p.name);
  }

  /** Apply any new raw events to the selected projections (all by default). */
  async catchUp(name?: string): Promise<ProjectionRunResult[]> {
    const results: ProjectionRunResult[] = [];
    for (const projection of this.select(name)) {
      results.push(await this.catchUpOne(projection));
    }
    return results;
  }

  /** Reset the selected projections and replay all raw events from scratch. */
  async rebuild(name?: string): Promise<ProjectionRunResult[]> {
    const results: ProjectionRunResult[] = [];
    for (const projection of this.select(name)) {
      results.push(await this.rebuildOne(projection));
    }
    return results;
  }

  private select(name?: string): EventProjection[] {
    if (!name) return this.projections;
    const match = this.projections.filter((p) => p.name === name);
    if (match.length === 0) {
      throw new Error(`Unknown projection "${name}". Known: ${this.listProjections().join(', ')}`);
    }
    return match;
  }

  private async catchUpOne(projection: EventProjection): Promise<ProjectionRunResult> {
    let eventsApplied = 0;
    let lastIngestSeq = '0';

    for (;;) {
      const batch = await this.dataSource.transaction(async (manager) => {
        await this.lock(manager, projection.name);
        const checkpoint = await this.loadCheckpoint(manager, projection.name);
        const applied = await this.applyNextBatch(manager, projection, checkpoint);
        return { applied, lastIngestSeq: checkpoint.lastIngestSeq };
      });
      eventsApplied += batch.applied;
      lastIngestSeq = batch.lastIngestSeq;
      if (batch.applied < this.batchSize) break;
    }

    if (eventsApplied > 0) {
      logger.info(
        { projection: projection.name, eventsApplied, lastIngestSeq },
        'Projection caught up',
      );
    }
    return { projection: projection.name, eventsApplied, lastIngestSeq, rebuilt: false };
  }

  private async rebuildOne(projection: EventProjection): Promise<ProjectionRunResult> {
    return this.dataSource.transaction(async (manager) => {
      await this.lock(manager, projection.name);
      const checkpoint = await this.loadCheckpoint(manager, projection.name);

      await projection.reset(manager);
      checkpoint.lastIngestSeq = '0';
      checkpoint.eventsApplied = '0';
      checkpoint.lastRebuiltAt = new Date();

      let eventsApplied = 0;
      for (;;) {
        const applied = await this.applyNextBatch(manager, projection, checkpoint);
        eventsApplied += applied;
        if (applied < this.batchSize) break;
      }
      // Persist the reset even when there were no raw events to replay.
      await manager.getRepository(ProjectionCheckpoint).save(checkpoint);

      logger.info(
        { projection: projection.name, eventsApplied, lastIngestSeq: checkpoint.lastIngestSeq },
        'Projection rebuilt from raw events',
      );
      return {
        projection: projection.name,
        eventsApplied,
        lastIngestSeq: checkpoint.lastIngestSeq,
        rebuilt: true,
      };
    });
  }

  /**
   * Apply the next batch of settled raw events after the checkpoint and advance
   * it in place (and in the DB). Returns the number of events applied.
   */
  private async applyNextBatch(
    manager: EntityManager,
    projection: EventProjection,
    checkpoint: ProjectionCheckpoint,
  ): Promise<number> {
    const events = await manager.getRepository(IndexedEvent).find({
      where: {
        ingestSeq: MoreThan(checkpoint.lastIngestSeq),
        indexedAt: LessThanOrEqual(new Date(Date.now() - this.settleMs)),
      },
      order: { ingestSeq: 'ASC' },
      take: this.batchSize,
    });
    if (events.length === 0) return 0;

    await projection.apply(events, manager);

    checkpoint.lastIngestSeq = String(events[events.length - 1].ingestSeq);
    checkpoint.eventsApplied = String(Number(checkpoint.eventsApplied) + events.length);
    await manager.getRepository(ProjectionCheckpoint).save(checkpoint);
    return events.length;
  }

  private async loadCheckpoint(
    manager: EntityManager,
    projection: string,
  ): Promise<ProjectionCheckpoint> {
    const repo = manager.getRepository(ProjectionCheckpoint);
    const existing = await repo.findOne({ where: { projection } });
    if (existing) return existing;
    return repo.create({ projection, lastIngestSeq: '0', eventsApplied: '0', lastRebuiltAt: null });
  }

  private async lock(manager: EntityManager, projection: string): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `indexer_projection:${projection}`,
    ]);
  }
}
