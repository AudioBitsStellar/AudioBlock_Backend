import AppDataSource from '../config/db';
import { IndexedEvent } from '../entities/IndexedEvent';
import { FindOptionsWhere, Repository } from 'typeorm';
import logger from '../config/logger';

export interface InsertIndexedEventDTO {
  network?: string;
  contractId?: string;
  contractType?: string;
  eventType: string;
  eventId?: string;
  address?: string;
  txHash?: string;
  ledger?: number;
  payload?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export class IndexedEventService {
  private get repo(): Repository<IndexedEvent> {
    return AppDataSource.getRepository(IndexedEvent);
  }

  private isDuplicateError(err: unknown): boolean {
    const error = err as { code?: string; message?: string };
    return (
      error?.code === '23505' ||
      Boolean(error?.message?.includes('duplicate key')) ||
      Boolean(error?.message?.includes('UNIQUE constraint'))
    );
  }

  private buildWhere(
    network: string,
    eventId: string,
    contractId?: string,
    ledger?: number,
  ): FindOptionsWhere<IndexedEvent> {
    const where: FindOptionsWhere<IndexedEvent> = { network, eventId };
    if (contractId !== undefined) where.contractId = contractId;
    if (ledger !== undefined) where.ledger = ledger;
    return where;
  }

  /**
   * Idempotently insert an indexed on-chain event.
   * If the event already exists (by network, contractId, ledger, eventId) or by unique constraints,
   * this operation is a no-op and returns the existing event without throwing an error.
   */
  async upsertEvent(dto: InsertIndexedEventDTO): Promise<IndexedEvent> {
    const network = dto.network || 'stellar-testnet';
    const payload = dto.payload || dto.data || {};
    const eventId = dto.eventId || `${dto.txHash || 'event'}-${dto.ledger || 0}`;
    const where = this.buildWhere(network, eventId, dto.contractId, dto.ledger);

    const existing = await this.repo.findOne({ where });
    if (existing) {
      logger.debug(
        { network, contractId: dto.contractId, ledger: dto.ledger, eventId },
        'Duplicate indexed event detected; returning existing record (no-op)',
      );
      return existing;
    }

    try {
      const event = this.repo.create({
        network,
        contractId: dto.contractId,
        contractType: dto.contractType,
        eventType: dto.eventType,
        eventId,
        address: dto.address,
        txHash: dto.txHash,
        ledger: dto.ledger,
        payload,
        data: payload,
      });

      return await this.repo.save(event);
    } catch (err) {
      if (this.isDuplicateError(err)) {
        const raceExisting = await this.repo.findOne({ where });
        if (raceExisting) return raceExisting;
      }
      throw err;
    }
  }

  async getEventsByTxHash(txHash: string): Promise<IndexedEvent[]> {
    return this.repo.find({ where: { txHash } });
  }
}
