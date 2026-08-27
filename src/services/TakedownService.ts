import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { TakedownRequest, TakedownStatus, TakedownReason } from '../entities/TakedownRequest';
import { Song } from '../entities/Song';
import { TransactionLog } from '../entities/TransactionLog';
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

  async listRequests(filter?: {
    status?: TakedownStatus;
    songId?: string;
  }): Promise<TakedownRequest[]> {
    const where: any = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.songId) where.songId = filter.songId;
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
      takedown.resolvedAt = new Date();

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
}

export default TakedownService;
