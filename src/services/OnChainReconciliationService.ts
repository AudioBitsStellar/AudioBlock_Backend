import AppDataSource from '../config/db';
import { TransactionLog } from '../entities/TransactionLog';
import { IndexedEvent } from '../entities/IndexedEvent';
import logger from '../config/logger';

export interface ReconciliationMismatch {
  type: 'MISSING_ON_CHAIN' | 'STATUS_MISMATCH' | 'UNTRACKED_ON_CHAIN';
  txHash: string;
  transactionLogId?: string;
  indexedEventId?: string;
  description: string;
  details?: Record<string, unknown>;
}

export interface ReconciliationReport {
  scannedLogs: number;
  scannedEvents: number;
  matched: number;
  mismatches: ReconciliationMismatch[];
  timestamp: string;
}

export class OnChainReconciliationService {
  private get transactionLogRepo() {
    return AppDataSource.getRepository(TransactionLog);
  }

  private get indexedEventRepo() {
    return AppDataSource.getRepository(IndexedEvent);
  }

  private isLogMarkedFailed(log: TransactionLog): boolean {
    const pattern = /timed[-_ ]?out|timeout|fail|error|revert|rejected/i;
    return pattern.test(log.action) || pattern.test(log.description || '');
  }

  private evaluateLog(
    log: TransactionLog,
    onChainEvents?: IndexedEvent[],
  ): { matched: boolean; mismatch?: ReconciliationMismatch } {
    if (!onChainEvents || onChainEvents.length === 0) {
      const mismatch: ReconciliationMismatch = {
        type: 'MISSING_ON_CHAIN',
        txHash: log.txHash,
        transactionLogId: log.id,
        description: `TransactionLog ${log.id} has txHash ${log.txHash} but no corresponding IndexedEvent was found on-chain.`,
        details: {
          action: log.action,
          userId: log.user_id || log.userId,
          description: log.description,
        },
      };
      logger.warn({ mismatch }, 'On-chain reconciliation mismatch: MISSING_ON_CHAIN');
      return { matched: false, mismatch };
    }

    if (this.isLogMarkedFailed(log)) {
      const mismatch: ReconciliationMismatch = {
        type: 'STATUS_MISMATCH',
        txHash: log.txHash,
        transactionLogId: log.id,
        indexedEventId: onChainEvents[0].id,
        description: `TransactionLog ${log.id} marked as failed/timed out, but on-chain event ${onChainEvents[0].id} landed successfully.`,
        details: {
          logAction: log.action,
          logDescription: log.description,
          onChainEventType: onChainEvents[0].eventType,
        },
      };
      logger.error(
        { mismatch },
        'On-chain reconciliation mismatch: STATUS_MISMATCH (drift detected)',
      );
      return { matched: false, mismatch };
    }

    return { matched: true };
  }

  private evaluateUntrackedEvent(
    evt: IndexedEvent,
    logExists: boolean,
  ): ReconciliationMismatch | null {
    if (logExists || !evt.txHash) return null;

    const mismatch: ReconciliationMismatch = {
      type: 'UNTRACKED_ON_CHAIN',
      txHash: evt.txHash,
      indexedEventId: evt.id,
      description: `IndexedEvent ${evt.id} (${evt.eventType}) has txHash ${evt.txHash} with no backend TransactionLog entry.`,
      details: {
        eventType: evt.eventType,
        contractType: evt.contractType,
        address: evt.address,
      },
    };
    logger.warn({ mismatch }, 'On-chain reconciliation mismatch: UNTRACKED_ON_CHAIN');
    return mismatch;
  }

  /**
   * Reconciles TransactionLog entries against IndexedEvent entries by txHash.
   * Scans logs within the lookback window (default 24 hours).
   */
  async reconcile(lookbackHours = 24): Promise<ReconciliationReport> {
    const sinceDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const logs = await this.transactionLogRepo
      .createQueryBuilder('log')
      .where('log.txHash IS NOT NULL')
      .andWhere("log.txHash != ''")
      .andWhere('log.createdAt >= :sinceDate', { sinceDate })
      .getMany();

    const events = await this.indexedEventRepo
      .createQueryBuilder('event')
      .where('event.txHash IS NOT NULL')
      .andWhere("event.txHash != ''")
      .andWhere('event.createdAt >= :sinceDate', { sinceDate })
      .getMany();

    const eventMapByTxHash = new Map<string, IndexedEvent[]>();
    for (const evt of events) {
      if (evt.txHash) {
        const list = eventMapByTxHash.get(evt.txHash) || [];
        list.push(evt);
        eventMapByTxHash.set(evt.txHash, list);
      }
    }

    const logMapByTxHash = new Map<string, TransactionLog[]>();
    for (const log of logs) {
      if (log.txHash) {
        const list = logMapByTxHash.get(log.txHash) || [];
        list.push(log);
        logMapByTxHash.set(log.txHash, list);
      }
    }

    const mismatches: ReconciliationMismatch[] = [];
    let matched = 0;

    for (const log of logs) {
      const evaluation = this.evaluateLog(log, eventMapByTxHash.get(log.txHash));
      if (evaluation.matched) {
        matched++;
      } else if (evaluation.mismatch) {
        mismatches.push(evaluation.mismatch);
      }
    }

    for (const evt of events) {
      const mismatch = this.evaluateUntrackedEvent(evt, logMapByTxHash.has(evt.txHash || ''));
      if (mismatch) {
        mismatches.push(mismatch);
      }
    }

    return {
      scannedLogs: logs.length,
      scannedEvents: events.length,
      matched,
      mismatches,
      timestamp: new Date().toISOString(),
    };
  }
}
