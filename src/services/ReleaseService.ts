import { FindOptionsWhere, In, LessThanOrEqual, Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { Release, ReleaseStatus, ReleaseType } from '../entities/Release';
import { ReleaseTrack } from '../entities/ReleaseTrack';
import { Song } from '../entities/Song';
import { AppError } from '../errors/AppError';
import { isReleasePublished, PreSaveService } from './PreSaveService';

export interface CreateReleaseInput {
  title: string;
  artistId: string;
  releaseDate: string | Date;
  type: ReleaseType;
  coverArt?: string;
  songIds: string[];
  scheduledAt?: string | Date | null;
  status?: ReleaseStatus;
}

export interface UpdateReleaseInput {
  title?: string;
  releaseDate?: string | Date;
  type?: ReleaseType;
  coverArt?: string;
  scheduledAt?: string | Date | null;
  status?: ReleaseStatus;
}

export interface ReleaseWithTracks extends Release {
  tracks: { trackNumber: number; song: Song }[];
}

export class ReleaseService {
  private releaseRepo: Repository<Release>;
  private trackRepo: Repository<ReleaseTrack>;
  private songRepo: Repository<Song>;

  constructor() {
    this.releaseRepo = AppDataSource.getRepository(Release);
    this.trackRepo = AppDataSource.getRepository(ReleaseTrack);
    this.songRepo = AppDataSource.getRepository(Song);
  }

  private resolveScheduleOnCreate(input: CreateReleaseInput): {
    status: ReleaseStatus;
    scheduledAt: Date | null;
    publishedAt: Date | null;
  } {
    if (input.scheduledAt) {
      const scheduledDate = new Date(input.scheduledAt);
      if (isNaN(scheduledDate.getTime())) {
        throw AppError.validation('Invalid scheduledAt date format');
      }
      if (scheduledDate > new Date()) {
        return { status: ReleaseStatus.SCHEDULED, scheduledAt: scheduledDate, publishedAt: null };
      }
      return { status: ReleaseStatus.PUBLISHED, scheduledAt: null, publishedAt: new Date() };
    }

    if (input.status === ReleaseStatus.DRAFT) {
      return { status: ReleaseStatus.DRAFT, scheduledAt: null, publishedAt: null };
    }

    return { status: ReleaseStatus.PUBLISHED, scheduledAt: null, publishedAt: new Date() };
  }

  async create(input: CreateReleaseInput): Promise<ReleaseWithTracks> {
    if (!Object.values(ReleaseType).includes(input.type)) {
      throw AppError.validation(`type must be one of: ${Object.values(ReleaseType).join(', ')}`);
    }
    if (!Array.isArray(input.songIds) || input.songIds.length === 0) {
      throw AppError.validation('songIds must be a non-empty array');
    }

    const songs = await this.songRepo.findBy({ id: In(input.songIds) });
    if (songs.length !== input.songIds.length) {
      throw AppError.notFound('One or more songIds do not exist');
    }

    const { status, scheduledAt, publishedAt } = this.resolveScheduleOnCreate(input);

    const release = await this.releaseRepo.save(
      this.releaseRepo.create({
        title: input.title,
        artistId: input.artistId,
        releaseDate: new Date(input.releaseDate),
        type: input.type,
        status,
        scheduledAt,
        publishedAt,
        coverArt: input.coverArt,
      }),
    );

    await this.trackRepo.save(
      input.songIds.map((songId, index) =>
        this.trackRepo.create({ releaseId: release.id, songId, trackNumber: index + 1 }),
      ),
    );

    return this.getById(release.id);
  }

  /**
   * Manually and immediately publish a release (Issue #423).
   * Works for both draft and scheduled releases.
   */
  async publish(releaseId: string, artistId: string): Promise<Release> {
    const release = await this.releaseRepo.findOneBy({ id: releaseId });
    if (!release) throw AppError.notFound('Release not found');
    if (release.artistId !== artistId) {
      throw AppError.authorization('Only the release owner can publish this release');
    }

    release.status = ReleaseStatus.PUBLISHED;
    release.publishedAt = new Date();
    release.scheduledAt = null;

    return this.releaseRepo.save(release);
  }

  /**
   * Automatically publish releases whose scheduled publish time has arrived (Issue #423).
   *
   * @param asOf - Reference time to compare against (defaults to now, allows mocking in tests)
   * @returns The list of releases that were published
   */
  async publishScheduledReleases(asOf: Date = new Date()): Promise<Release[]> {
    const dueReleases = await this.releaseRepo.find({
      where: {
        status: ReleaseStatus.SCHEDULED,
        scheduledAt: LessThanOrEqual(asOf),
      },
    });

    const published: Release[] = [];
    for (const release of dueReleases) {
      release.status = ReleaseStatus.PUBLISHED;
      release.publishedAt = release.scheduledAt || asOf;
      published.push(await this.releaseRepo.save(release));
    }

    return published;
  }

  async findPaginated(page = 1, limit = 20, artistId?: string, status?: ReleaseStatus) {
    const skip = (page - 1) * limit;
    const whereClause: FindOptionsWhere<Release> = {};
    if (artistId) whereClause.artistId = artistId;
    if (status) whereClause.status = status;

    const [items, total] = await this.releaseRepo.findAndCount({
      where: whereClause,
      order: { releaseDate: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data: items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getById(releaseId: string): Promise<ReleaseWithTracks> {
    const release = await this.releaseRepo.findOneBy({ id: releaseId });
    if (!release) throw AppError.notFound('Release not found');

    const tracks = await this.trackRepo.find({
      where: { releaseId },
      order: { trackNumber: 'ASC' },
    });
    const songs = await this.songRepo.findBy({ id: In(tracks.map((t) => t.songId)) });
    const songById = new Map(songs.map((s) => [s.id, s]));

    return {
      ...release,
      tracks: tracks
        .map((t) => ({ trackNumber: t.trackNumber, song: songById.get(t.songId)! }))
        .filter((t) => t.song),
    };
  }

  private resolveScheduleOnUpdate(
    updates: UpdateReleaseInput,
    release: Release,
  ): {
    status: ReleaseStatus;
    scheduledAt?: Date | null;
    publishedAt?: Date | null;
  } {
    const initialStatus = updates.status !== undefined ? updates.status : release.status;

    if (updates.scheduledAt === undefined) {
      return {
        status: initialStatus,
        scheduledAt: release.scheduledAt,
        publishedAt: release.publishedAt,
      };
    }

    if (updates.scheduledAt === null) {
      return { status: initialStatus, scheduledAt: null, publishedAt: release.publishedAt };
    }

    const scheduledDate = new Date(updates.scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      throw AppError.validation('Invalid scheduledAt date format');
    }

    if (scheduledDate > new Date()) {
      return { status: ReleaseStatus.SCHEDULED, scheduledAt: scheduledDate, publishedAt: null };
    }

    return { status: ReleaseStatus.PUBLISHED, scheduledAt: null, publishedAt: new Date() };
  }

  async update(
    releaseId: string,
    requesterId: string,
    updates: UpdateReleaseInput,
  ): Promise<Release> {
    const release = await this.releaseRepo.findOneBy({ id: releaseId });
    if (!release) throw AppError.notFound('Release not found');
    if (release.artistId !== requesterId) {
      throw AppError.authorization('Only the release owner can update this release');
    }

    if (updates.type && !Object.values(ReleaseType).includes(updates.type)) {
      throw AppError.validation(`type must be one of: ${Object.values(ReleaseType).join(', ')}`);
    }

    if (updates.status && !Object.values(ReleaseStatus).includes(updates.status)) {
      throw AppError.validation(
        `status must be one of: ${Object.values(ReleaseStatus).join(', ')}`,
      );
    }

    const schedule = this.resolveScheduleOnUpdate(updates, release);
    const wasUpcoming = !isReleasePublished(release.releaseDate);

    Object.assign(release, {
      ...(updates.title !== undefined && { title: updates.title }),
      ...(updates.releaseDate !== undefined && { releaseDate: new Date(updates.releaseDate) }),
      ...(updates.type !== undefined && { type: updates.type }),
      ...(updates.coverArt !== undefined && { coverArt: updates.coverArt }),
      status: schedule.status,
      scheduledAt: schedule.scheduledAt,
      publishedAt: schedule.publishedAt,
    });

    const saved = await this.releaseRepo.save(release);

    // Moving the date into the past is a publish: pre-saved releases must
    // auto-appear in each fan's library at that moment (Issue #424).
    if (wasUpcoming && isReleasePublished(saved.releaseDate)) {
      await new PreSaveService().fulfillForRelease(saved.id);
    }

    return saved;
  }

  /**
   * Publishes an upcoming release immediately (Issue #424).
   *
   * Owner-only. A future `releaseDate` is moved to now; an already-published
   * release is a no-op for the date but still fulfills any pending pre-saves
   * so pre-saved releases auto-appear in each fan's library at publish time.
   */
  async publish(
    releaseId: string,
    requesterId: string,
  ): Promise<{ release: ReleaseWithTracks; fulfilled: number; savesCreated: number }> {
    const release = await this.releaseRepo.findOneBy({ id: releaseId });
    if (!release) throw AppError.notFound('Release not found');
    if (release.artistId !== requesterId) {
      throw AppError.authorization('Only the release owner can publish this release');
    }

    if (!isReleasePublished(release.releaseDate)) {
      release.releaseDate = new Date();
      await this.releaseRepo.save(release);
    }

    const { fulfilled, savesCreated } = await new PreSaveService().fulfillForRelease(release.id);

    return { release: await this.getById(release.id), fulfilled, savesCreated };
  }
}
