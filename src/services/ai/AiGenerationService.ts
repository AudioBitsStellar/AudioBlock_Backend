import { Repository } from 'typeorm';
import AppDataSource from '../../config/db';
import { AiGenerationRecord } from '../../entities/AiGenerationRecord';
import { Song } from '../../entities/Song';
import { AppError } from '../../errors/AppError';
import { isAiFeatureEnabled } from '../../config/aiFeatureFlags';
import { JobQueueService } from '../JobQueueService';
import { getAiProvider } from './index';
import logger from '../../config/logger';

export type AiGenerationFeature = 'coverArt' | 'descriptions';

/** JobQueueService job `type` used for each feature — handlers register against these. */
export const AI_JOB_TYPE: Record<AiGenerationFeature, string> = {
  coverArt: 'ai.generate_cover_art',
  descriptions: 'ai.generate_description',
};

export interface AiGenerationJobPayload {
  recordId: string;
}

/**
 * Routes slow AI operations (cover art, long descriptions — issue: "may be
 * too slow for a synchronous request/response cycle") through
 * JobQueueService instead of the request/response cycle, and announces
 * completion over the existing webhook system (see WebhookService /
 * docs/WEBHOOK_IMPLEMENTATION_PLAN.md) as `ai.generation.completed`.
 */
export class AiGenerationService {
  private recordRepo: Repository<AiGenerationRecord>;
  private songRepo: Repository<Song>;

  constructor() {
    this.recordRepo = AppDataSource.getRepository(AiGenerationRecord);
    this.songRepo = AppDataSource.getRepository(Song);
  }

  /**
   * Creates a pending generation record and enqueues the async job. Returns
   * immediately — the caller polls `getRecord` or subscribes to the
   * `ai.generation.completed` webhook event for the result.
   */
  async requestGeneration(
    feature: AiGenerationFeature,
    songId: string,
    userId: string,
  ): Promise<AiGenerationRecord> {
    if (!isAiFeatureEnabled(feature)) {
      throw AppError.businessLogic(
        `The "${feature}" AI feature is not enabled`,
        undefined,
        'AI_FEATURE_DISABLED',
      );
    }

    const song = await this.songRepo.findOneBy({ id: songId });
    if (!song) {
      throw AppError.notFound('Song not found', undefined, 'SONG_NOT_FOUND');
    }
    if (song.artistId !== userId) {
      throw AppError.authorization(
        'You can only request AI generation for your own songs',
        undefined,
        'NOT_SONG_OWNER',
      );
    }

    const record = this.recordRepo.create({
      songId,
      userId,
      feature,
      status: 'pending',
    });
    const saved = await this.recordRepo.save(record);

    const payload: AiGenerationJobPayload = { recordId: saved.id };
    await JobQueueService.enqueue(AI_JOB_TYPE[feature], payload, { priority: 'low' });

    return saved;
  }

  /** Fetches a generation record, scoped to its owner. */
  async getRecord(recordId: string, userId: string): Promise<AiGenerationRecord> {
    const record = await this.recordRepo.findOneBy({ id: recordId });
    if (!record || record.userId !== userId) {
      throw AppError.notFound('AI generation record not found');
    }
    return record;
  }

  /**
   * Runs the provider call for a queued job and persists the result. Throws
   * on failure so the JobQueueService worker retries with backoff — callers
   * should only call {@link markFailed} once retries are exhausted.
   */
  async generate(feature: AiGenerationFeature, recordId: string): Promise<void> {
    const record = await this.recordRepo.findOneBy({ id: recordId });
    if (!record) {
      logger.warn({ recordId, feature }, 'AI generation record no longer exists; skipping job');
      return;
    }

    const song = await this.songRepo.findOneBy({ id: record.songId });
    if (!song) {
      throw new Error(`Song ${record.songId} no longer exists`);
    }

    const provider = getAiProvider();

    if (feature === 'coverArt') {
      const result = await provider.generateCoverArt({ songId: song.id, title: song.title });
      await this.markCompleted(record, provider.name, { resultUrl: result.imageUrl });
    } else {
      const result = await provider.generateDescription({
        songId: song.id,
        title: song.title,
      });
      await this.markCompleted(record, provider.name, { resultText: result.description });
    }
  }

  /** Marks a job permanently failed (retries exhausted) and notifies via webhook. */
  async markFailed(recordId: string, errorMessage: string): Promise<void> {
    const record = await this.recordRepo.findOneBy({ id: recordId });
    if (!record) return;

    record.status = 'failed';
    record.errorMessage = errorMessage;
    record.completedAt = new Date();
    await this.recordRepo.save(record);

    await this.emitWebhook(record);
  }

  private async markCompleted(
    record: AiGenerationRecord,
    provider: string,
    result: { resultText?: string; resultUrl?: string },
  ): Promise<void> {
    record.status = 'completed';
    record.provider = provider;
    record.resultText = result.resultText;
    record.resultUrl = result.resultUrl;
    record.completedAt = new Date();
    await this.recordRepo.save(record);

    await this.emitWebhook(record);
  }

  private async emitWebhook(record: AiGenerationRecord): Promise<void> {
    try {
      const { WebhookService } = await import('../WebhookService');
      const webhook = new WebhookService();
      await webhook.publish('ai.generation.completed', {
        recordId: record.id,
        songId: record.songId,
        userId: record.userId,
        feature: record.feature,
        status: record.status,
        resultText: record.resultText,
        resultUrl: record.resultUrl,
        errorMessage: record.errorMessage,
      });
    } catch (webhookErr) {
      logger.error(
        { recordId: record.id, err: webhookErr },
        'Failed to publish AI generation webhook event',
      );
    }
  }
}
