import AppDataSource from '../../config/db';
import { Song } from '../../entities/Song';
import { SongPlayEvent } from '../../entities/SongPlayEvent';

export class PlaybackService {
  private songRepo = AppDataSource.getRepository(Song);
  private playEventRepo = AppDataSource.getRepository(SongPlayEvent);

  async recordPlayback(songId: string, userId: string | null, ip: string) {
    // Atomic increment of playCount
    await this.songRepo.increment({ id: songId }, 'playCount', 1);

    // Record play event for analytics/aggregation
    const playEvent = this.playEventRepo.create({
      songId,
      listenerId: userId || null,
      listenerKey: userId ? null : ip,
    });
    await this.playEventRepo.save(playEvent);

    return true;
  }
}
