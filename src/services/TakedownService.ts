import { LessThan, Repository } from 'typeorm';
import AppDataSource from '../config/db';
import {
  TakedownRequest,
  TakedownStatus,
  TakedownReason,
  TAKEDOWN_COUNTER_NOTICE_MAX_LENGTH,
  TAKEDOWN_COUNTER_NOTICE_WINDOW_MS,
  TAKEDOWN_REVIEW_SLA_MS,
} from '../entities/TakedownRequest';
import { Song } from '../entities/Song';
import { TransactionLog } from '../entities/TransactionLog';
import { AppError } from '../errors/AppError';
import logger from '../config/logger';

export class TakedownService {
  private takedownRepo: Repository<TakedownRequest>;
  private songRepo: Repository<Song>;
  private logRepo: Repository<TransactionLog>;

  constructor() {
    this.takedownRepo = AppDataSource.getRepository(TakedownRequest);
    this.songRepo = AppDataSource.getRepository(Song);
    this.logRepo = AppDataSource.getRepository(TransactionLog);
  }

  async createRequest(
    requestedBy: string,
    songId: string,
    reason: TakedownReason = TakedownReason.COPYRIGHT,
    description?: string,
    evidenceUrl?: string,
  ): Promise<TakedownRequest> {
    const song = await this.songRepo.findOneBy({ id: songId });
    if (!song) throw Object.assign(new Error('Song not found'), { statusCode: 404 });

    // Prevent duplicate pending requests for same song by same requester?
    // Allow but warn if already pending
    const existingPending = await this.takedownRepo.findOne({
      where: { songId, status: TakedownStatus.PENDING },
    });
    if (existingPending) {
      // Allow multiple but could also throw; we allow and log
      logger.warn({ songId, requestedBy }, 'Duplicate pending takedown request exists');
    }

    const takedown = this.takedownRepo.create({
      songId,
      requestedBy,
      reason,
      description: description || null,
      evidenceUrl: evidenceUrl || null,
      status: TakedownStatus.PENDING,
      previousFlagged: song.flagged,
      reviewDueAt: new Date(Date.now() + TAKEDOWN_REVIEW_SLA_MS),
    });

    const saved = await this.takedownRepo.save(takedown);

    await this.logRepo.save({
      userId: requestedBy,
      action: 'takedown_request_created',
      details: { takedownId: saved.id, songId, reason },
    } as any);

    logger.info({ takedownId: saved.id, songId, requestedBy }, 'Takedown request created');
    return saved;
  }

  /**
   * Requests matching the filter, newest first. `overdue` narrows the list to
   * pending requests whose review deadline has passed (#981).
   */
  async listRequests(filter?: {
    status?: TakedownStatus;
    songId?: string;
    overdue?: boolean;
  }): Promise<TakedownRequest[]> {
    const where: any = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.songId) where.songId = filter.songId;
    if (filter?.overdue) {
      where.status = TakedownStatus.PENDING;
      where.reviewDueAt = LessThan(new Date());
    }
    return this.takedownRepo.find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['song', 'requester'],
    });
  }

  async getRequest(id: string): Promise<TakedownRequest> {
    const req = await this.takedownRepo.findOne({ where: { id }, relations: ['song'] });
    if (!req) throw Object.assign(new Error('Takedown request not found'), { statusCode: 404 });
    return req;
  }

  /**
   * Admin workflow to review takedown.
   * - approve: temporarily unpublish song (flagged=true) pending review; reversible
   * - reject: deny claim, keep song published
   * - reverse: if previously approved and claim resolved in artist's favor, republish
   */
  // eslint-disable-next-line complexity -- existing method tracked in docs/refactoring_priority.md
  async reviewRequest(
    takedownId: string,
    adminId: string,
    action: 'approve' | 'reject' | 'reverse',
    reviewNotes?: string,
  ): Promise<TakedownRequest> {
    const takedown = await this.takedownRepo.findOne({ where: { id: takedownId } });
    if (!takedown)
      throw Object.assign(new Error('Takedown request not found'), { statusCode: 404 });

    const song = await this.songRepo.findOneBy({ id: takedown.songId });
    if (!song) throw Object.assign(new Error('Song not found for takedown'), { statusCode: 404 });

    if (action === 'approve') {
      if (takedown.status === TakedownStatus.APPROVED) throw new Error('Takedown already approved');
      // Snapshot previous flagged state before unpublishing
      takedown.previousFlagged = song.flagged;
      takedown.status = TakedownStatus.APPROVED;
      takedown.reviewedBy = adminId;
      takedown.reviewNotes = reviewNotes || null;
      const approvedAt = new Date();
      takedown.resolvedAt = approvedAt;
      // The artist may counter-notice for a fixed window after approval (#981).
      takedown.counterNoticeDueAt = new Date(
        approvedAt.getTime() + TAKEDOWN_COUNTER_NOTICE_WINDOW_MS,
      );

      // Temporarily unpublish: use flagged fields (distinct from generic flag but reuses mechanism for streaming gate)
      song.flagged = true;
      song.flaggedAt = new Date();
      song.flaggedBy = adminId;
      song.flagReason = `takedown:${takedown.id}:${takedown.reason}:${reviewNotes || ''}`.slice(
        0,
        500,
      );

      await this.songRepo.save(song);
      await this.logRepo.save({
        userId: adminId,
        action: 'takedown_approved',
        details: { takedownId, songId: song.id },
      } as any);
      logger.info({ takedownId, songId: song.id, adminId }, 'Takedown approved — song unpublished');
    } else if (action === 'reject') {
      if (takedown.status !== TakedownStatus.PENDING)
        throw new Error('Only pending takedowns can be rejected');
      takedown.status = TakedownStatus.REJECTED;
      takedown.reviewedBy = adminId;
      takedown.reviewNotes = reviewNotes || null;
      takedown.resolvedAt = new Date();
      await this.logRepo.save({
        userId: adminId,
        action: 'takedown_rejected',
        details: { takedownId, songId: song.id },
      } as any);
      logger.info({ takedownId, songId: song.id, adminId }, 'Takedown rejected');
    } else if (action === 'reverse') {
      if (takedown.status !== TakedownStatus.APPROVED)
        throw new Error('Only approved takedowns can be reversed');
      takedown.status = TakedownStatus.REVERSED;
      takedown.reviewedBy = adminId;
      takedown.reviewNotes = reviewNotes || null;
      takedown.resolvedAt = new Date();

      // Reversible unpublish: restore previous flagged state
      // If song was not flagged before takedown, unflag it; otherwise keep previous flagged state
      if (!takedown.previousFlagged) {
        song.flagged = false;
        song.flaggedAt = null;
        song.flaggedBy = null;
        song.flagReason = null;
      } else {
        // Keep flagged but update reason to indicate reversal? For strict reversibility we keep flagged=true if previously flagged.
        // We still clear takedown-specific flag reason if it matches takedown id
        if (song.flagReason?.includes(`takedown:${takedown.id}`)) {
          // If previous was flagged, we need to restore previous flag metadata — but we only stored boolean.
          // Keep flagged true but reset flagReason to generic
          song.flagReason = 'previously_flagged';
        }
      }

      await this.songRepo.save(song);
      await this.logRepo.save({
        userId: adminId,
        action: 'takedown_reversed',
        details: { takedownId, songId: song.id },
      } as any);
      logger.info({ takedownId, songId: song.id, adminId }, 'Takedown reversed — song republished');
    } else {
      throw new Error('Invalid action');
    }

    return this.takedownRepo.save(takedown);
  }

  /**
   * Artist's counter-notice against an approved takedown (#981).
   *
   * Only the artist who owns the song may file one, once, and only before the
   * counter-notice window closes. Filing it does not change the takedown's status:
   * an admin still decides whether to reverse it.
   *
   * @throws {AppError} 403 when the caller does not own the song; 409 when the
   *   takedown is not approved, a counter-notice already exists, or the window closed.
   */
  async submitCounterNotice(
    takedownId: string,
    artistId: string,
    statement: string,
  ): Promise<TakedownRequest> {
    const takedown = await this.getRequest(takedownId);

    if (takedown.song?.artistId !== artistId) {
      throw AppError.authorization(
        'Only the artist of this song can file a counter-notice',
        undefined,
        'COUNTER_NOTICE_FORBIDDEN',
      );
    }
    if (takedown.status !== TakedownStatus.APPROVED) {
      throw AppError.conflict(
        'Counter-notices can only be filed against approved takedowns',
        undefined,
        'TAKEDOWN_NOT_APPROVED',
      );
    }
    if (takedown.counterNotice) {
      throw AppError.conflict(
        'A counter-notice has already been filed for this takedown',
        undefined,
        'COUNTER_NOTICE_EXISTS',
      );
    }

    const now = new Date();
    if (takedown.counterNoticeDueAt && now > takedown.counterNoticeDueAt) {
      throw AppError.conflict(
        'The counter-notice window for this takedown has closed',
        undefined,
        'COUNTER_NOTICE_WINDOW_CLOSED',
      );
    }

    const text = statement.trim();
    if (!text) {
      throw AppError.validation('statement must not be blank', undefined, 'STATEMENT_REQUIRED');
    }

    takedown.counterNotice = text.slice(0, TAKEDOWN_COUNTER_NOTICE_MAX_LENGTH);
    takedown.counterNoticeAt = now;
    takedown.counterNoticeBy = artistId;
    const saved = await this.takedownRepo.save(takedown);

    await this.logRepo.save({
      userId: artistId,
      action: 'takedown_counter_notice_submitted',
      details: { takedownId, songId: takedown.songId },
    } as any);

    logger.info({ takedownId, songId: takedown.songId, artistId }, 'Counter-notice filed');
    return saved;
  }
}

export default TakedownService;
