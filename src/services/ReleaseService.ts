import { In, Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { Release, ReleaseType } from '../entities/Release';
import { ReleaseTrack } from '../entities/ReleaseTrack';
import { Song } from '../entities/Song';
import { AppError } from '../errors/AppError';

export interface CreateReleaseInput {
  title: string;
  artistId: string;
  releaseDate: string | Date;
  type: ReleaseType;
  coverArt?: string;
  songIds: string[];
}

export interface UpdateReleaseInput {
  title?: string;
  releaseDate?: string | Date;
  type?: ReleaseType;
  coverArt?: string;
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

    const release = await this.releaseRepo.save(
      this.releaseRepo.create({
        title: input.title,
        artistId: input.artistId,
        releaseDate: new Date(input.releaseDate),
        type: input.type,
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

  async findPaginated(page = 1, limit = 20, artistId?: string) {
    const skip = (page - 1) * limit;
    const [items, total] = await this.releaseRepo.findAndCount({
      where: artistId ? { artistId } : {},
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

    Object.assign(release, {
      ...(updates.title !== undefined && { title: updates.title }),
      ...(updates.releaseDate !== undefined && { releaseDate: new Date(updates.releaseDate) }),
      ...(updates.type !== undefined && { type: updates.type }),
      ...(updates.coverArt !== undefined && { coverArt: updates.coverArt }),
    });

    return this.releaseRepo.save(release);
  }
}
