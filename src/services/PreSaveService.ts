import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { Release } from '../entities/Release';
import { ReleaseTrack } from '../entities/ReleaseTrack';
import { ReleasePreSave } from '../entities/ReleasePreSave';
import { UserSave, DEFAULT_SAVE_COLLECTION } from '../entities/UserSave';
import { AppError } from '../errors/AppError';
import { validateUUID } from '../validators/ServiceValidator';

/** Outcome of a pre-save: `alreadyPreSaved` distinguishes a no-op from a fresh row. */
export interface PreSaveResult {
  preSave: ReleasePreSave;
  alreadyPreSaved: boolean;
}

/** Pre-save status for a release, including the fan's own state and total interest. */
export interface PreSaveStatus {
  releaseId: string;
  isPreSaved: boolean;
  preSaveCount: number;
  isPublished: boolean;
}

/**
 * True once a release's `releaseDate` has arrived. A release with a future
 * `releaseDate` is upcoming (pre-saveable); one at or before now is published.
 */
export function isReleasePublished(releaseDate: Date | string): boolean {
  return new Date(releaseDate).getTime() <= Date.now();
}

/**
 * Pre-save campaigns for upcoming releases (Issue #424).
 *
 * Fans record interest before publish; on publish the pre-saves are fulfilled
 * into each fan's library (`user_saves`) so the release auto-appears there.
 */
export class PreSaveService {
  private preSaveRepo: Repository<ReleasePreSave>;
  private releaseRepo: Repository<Release>;
  private trackRepo: Repository<ReleaseTrack>;
  private saveRepo: Repository<UserSave>;

  constructor() {
    this.preSaveRepo = AppDataSource.getRepository(ReleasePreSave);
    this.releaseRepo = AppDataSource.getRepository(Release);
    this.trackRepo = AppDataSource.getRepository(ReleaseTrack);
    this.saveRepo = AppDataSource.getRepository(UserSave);
  }

  /**
   * Records a fan's interest in an upcoming release. Idempotent: pre-saving
   * twice returns the existing row rather than duplicating it.
   *
   * @param userId - Fan recording interest
   * @param releaseId - Upcoming release to pre-save
   * @throws {AppError} When the release does not exist or is already published
   */
  async preSave(userId: string, releaseId: string): Promise<PreSaveResult> {
    validateUUID(userId, 'userId');
    validateUUID(releaseId, 'releaseId');

    const release = await this.releaseRepo.findOneBy({ id: releaseId });
    if (!release) {
      throw AppError.notFound('Release not found');
    }

    if (isReleasePublished(release.releaseDate)) {
      throw AppError.businessLogic('Release is already published; pre-save is no longer available');
    }

    const existing = await this.preSaveRepo.findOne({ where: { userId, releaseId } });
    if (existing) {
      return { preSave: existing, alreadyPreSaved: true };
    }

    const preSave = this.preSaveRepo.create({ userId, releaseId });

    try {
      const saved = await this.preSaveRepo.save(preSave);
      return { preSave: saved, alreadyPreSaved: false };
    } catch (error) {
      // Two concurrent requests race past the existence check above; the unique
      // constraint is the real guard, so treat a violation as "already pre-saved".
      const raced = await this.preSaveRepo.findOne({ where: { userId, releaseId } });
      if (raced) {
        return { preSave: raced, alreadyPreSaved: true };
      }
      throw error;
    }
  }

  /**
   * Cancels a fan's pre-save for an upcoming release.
   *
   * @throws {AppError} When no pre-save exists for this fan and release
   */
  async unPreSave(userId: string, releaseId: string): Promise<void> {
    validateUUID(userId, 'userId');
    validateUUID(releaseId, 'releaseId');

    const existing = await this.preSaveRepo.findOne({ where: { userId, releaseId } });
    if (!existing) {
      throw AppError.notFound('Pre-save not found for this release');
    }

    await this.preSaveRepo.remove(existing);
  }

  /**
   * Reports whether the fan pre-saved the release and how many fans did in total.
   */
  async getStatus(userId: string, releaseId: string): Promise<PreSaveStatus> {
    validateUUID(userId, 'userId');
    validateUUID(releaseId, 'releaseId');

    const release = await this.releaseRepo.findOneBy({ id: releaseId });
    if (!release) {
      throw AppError.notFound('Release not found');
    }

    const [existing, preSaveCount] = await Promise.all([
      this.preSaveRepo.findOne({ where: { userId, releaseId } }),
      this.preSaveRepo.count({ where: { releaseId } }),
    ]);

    return {
      releaseId,
      isPreSaved: existing !== null,
      preSaveCount,
      isPublished: isReleasePublished(release.releaseDate),
    };
  }

  /**
   * Lists a fan's pre-saves with their releases, newest first.
   */
  async listForUser(userId: string): Promise<ReleasePreSave[]> {
    validateUUID(userId, 'userId');

    return this.preSaveRepo.find({
      where: { userId },
      relations: ['release'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Fulfills every pending pre-save for a release by copying its tracks into
   * each fan's library. Idempotent: songs already saved are skipped, and
   * already-fulfilled rows are not re-processed.
   *
   * Called at publish time (see `ReleaseService.publish`).
   *
   * @param releaseId - Newly published release
   * @returns Number of pre-save rows fulfilled
   */
  async fulfillForRelease(releaseId: string): Promise<{ fulfilled: number; savesCreated: number }> {
    validateUUID(releaseId, 'releaseId');

    const preSaves = await this.preSaveRepo.find({ where: { releaseId } });
    const pending = preSaves.filter((p) => !p.fulfilledAt);
    if (pending.length === 0) {
      return { fulfilled: 0, savesCreated: 0 };
    }

    const tracks = await this.trackRepo.find({ where: { releaseId } });
    const songIds = [...new Set(tracks.map((t) => t.songId))];

    let savesCreated = 0;

    if (songIds.length > 0) {
      for (const preSave of pending) {
        for (const songId of songIds) {
          const existing = await this.saveRepo.findOne({
            where: { userId: preSave.userId, songId, collection: DEFAULT_SAVE_COLLECTION },
          });
          if (existing) {
            continue;
          }
          try {
            await this.saveRepo.save(
              this.saveRepo.create({
                userId: preSave.userId,
                songId,
                collection: DEFAULT_SAVE_COLLECTION,
              }),
            );
            savesCreated += 1;
          } catch {
            // A concurrent publish raced us to the same save; the unique
            // constraint is the guard, so skipping is correct.
            const raced = await this.saveRepo.findOne({
              where: { userId: preSave.userId, songId, collection: DEFAULT_SAVE_COLLECTION },
            });
            if (!raced) {
              throw new Error('Failed to save pre-saved song to library');
            }
          }
        }
      }
    }

    const now = new Date();
    for (const preSave of pending) {
      preSave.fulfilledAt = now;
    }
    await this.preSaveRepo.save(pending);

    return { fulfilled: pending.length, savesCreated };
  }
}
