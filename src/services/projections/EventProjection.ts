import { EntityManager } from 'typeorm';
import { IndexedEvent } from '../../entities/IndexedEvent';

/**
 * A derived read model built purely from raw `indexed_events` rows (Issue #261).
 *
 * Projections must be deterministic functions of the raw event stream so that
 * `reset()` followed by replaying every event rebuilds the same state.
 * Both methods run inside the projector's transaction.
 */
export interface EventProjection {
  /** Stable name; used as the checkpoint key. */
  readonly name: string;
  /** Remove all derived state so the projection can be replayed from scratch. */
  reset(manager: EntityManager): Promise<void>;
  /** Apply a batch of raw events, ordered by `ingestSeq` ascending. */
  apply(events: IndexedEvent[], manager: EntityManager): Promise<void>;
}
