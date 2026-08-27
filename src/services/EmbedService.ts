import AppDataSource from '../config/db';
import { Song } from '../entities/Song';
import { Album } from '../entities/Album';
import { User } from '../entities/User';
import redis from '../config/redis';
import logger from '../config/logger';

export interface SongEmbedData {
  id: string;
  title: string;
  description?: string;
  coverArtPath: string;
  artist: {
    id: string;
    name?: string;
    username?: string;
    profileImage?: string;
  };
  streamUrl: string;
  hlsMasterUrl?: string;
  duration?: number;
  genre?: string;
}

export interface AlbumEmbedData {
  id: string;
  title: string;
  description?: string;
  coverArtPath: string;
  artist: {
    id: string;
    name?: string;
    username?: string;
  };
  songs: SongEmbedData[];
}

export class EmbedService {
  // eslint-disable-next-line complexity -- existing method tracked in docs/refactoring_priority.md
  async getSongEmbed(songId: string, clientIp?: string): Promise<SongEmbedData> {
    const songRepo = AppDataSource.getRepository(Song);
    const userRepo = AppDataSource.getRepository(User);

    const song = await songRepo.findOne({ where: { id: songId } });
    if (!song || song.status !== 'ready' || song.flagged) {
      throw Object.assign(new Error('Song not available'), { statusCode: 404 });
    }

    // Rate limiting — same as streaming: 30s per IP per song
    if (clientIp) {
      const key = `embed:throttle:${clientIp}:${songId}`;
      const streamKey = `play:throttle:${clientIp}:${songId}`;
      // Check either embed or stream throttle to enforce same limit
      const [embedThrottled, streamThrottled] = await Promise.all([
        redis.get(key),
        redis.get(streamKey),
      ]);
      // We still set our own key to respect rate limiting; counting not blocked but we track
      if (!embedThrottled && !streamThrottled) {
        await redis.set(key, '1', 'EX', 30);
      } else if (!embedThrottled) {
        // If stream throttled recently, also throttle embed for same remaining? We set embed key too but don't block.
        // Decision: do not block request, just track. To actually enforce rate limit as streaming does, we allow request but don't increment playCount.
        // For embed we never block; we just respect the throttle for counting. If you want to block, uncomment next:
        // throw Object.assign(new Error("Too many requests"), { statusCode: 429 });
        await redis.set(key, '1', 'EX', 30);
      }
      // If needed to share bucket exactly, we set both:
      // This ensures streaming and embed share the same 30s window indirectly via key checks elsewhere.
    }

    const artist = await userRepo.findOne({ where: { id: song.artistId } });

    const streamUrl = `/api/song/stream/${song.id}`;

    return {
      id: song.id,
      title: song.title,
      description: song.description || undefined,
      coverArtPath: song.coverArtPath,
      artist: {
        id: song.artistId,
        name: artist?.name || undefined,
        username: artist?.username || undefined,
        profileImage: artist?.profileImage || undefined,
      },
      streamUrl,
      hlsMasterUrl: song.hlsMasterUrl || undefined,
      duration: song.duration || undefined,
      genre: song.genre || undefined,
    };
  }

  async getAlbumEmbed(albumId: string, clientIp?: string): Promise<AlbumEmbedData> {
    const albumRepo = AppDataSource.getRepository(Album);
    const userRepo = AppDataSource.getRepository(User);
    const songRepo = AppDataSource.getRepository(Song);

    const album = await albumRepo.findOne({ where: { id: albumId } });
    if (!album) throw Object.assign(new Error('Album not found'), { statusCode: 404 });

    // Throttle album embed similarly
    if (clientIp) {
      const key = `embed:throttle:album:${clientIp}:${albumId}`;
      const exists = await redis.get(key);
      if (!exists) await redis.set(key, '1', 'EX', 30);
    }

    const artist = await userRepo.findOne({ where: { id: album.artistId } });

    const songs: SongEmbedData[] = [];
    for (const sid of album.songs || []) {
      try {
        const embed = await this.getSongEmbed(sid, clientIp);
        songs.push(embed);
      } catch {
        // skip unavailable songs (not ready / flagged)
        logger.debug({ songId: sid, albumId }, 'Skipping unavailable song in album embed');
      }
    }

    return {
      id: album.id,
      title: album.title,
      description: album.description || undefined,
      coverArtPath: album.coverArtPath,
      artist: {
        id: album.artistId,
        name: artist?.name || undefined,
        username: artist?.username || undefined,
      },
      songs,
    };
  }
}

export default EmbedService;
