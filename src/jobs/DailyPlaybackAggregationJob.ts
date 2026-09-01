import AppDataSource from '../config/db';
import { SongPlayEvent } from '../entities/SongPlayEvent';
import { TransactionLogService } from '../services/TransactionLogService';
import logger from '../config/logger';

export async function runPlaybackAggregationJob(): Promise<void> {
  const playEventRepo = AppDataSource.getRepository(SongPlayEvent);
  const logService = new TransactionLogService();

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Note: we can use a raw query to group by song and count
  const results = await playEventRepo
    .createQueryBuilder('event')
    .select('event.songId', 'songId')
    .addSelect('COUNT(event.id)', 'playCount')
    .innerJoin('event.song', 'song')
    .addSelect('song.artistId', 'artistId')
    .where('event.playedAt BETWEEN :start AND :end', { start: yesterday, end: now })
    .groupBy('event.songId')
    .addGroupBy('song.artistId')
    .getRawMany();

  if (results.length === 0) {
    logger.info('No playback events to aggregate for the past 24 hours');
    return;
  }

  for (const row of results) {
    const { songId, artistId, playCount } = row;
    await logService.createLogEntry(
      artistId,
      '',
      'DAILY_PLAYBACK_AGGREGATION',
      `Song ${songId} received ${playCount} plays in the last 24 hours.`,
    );
  }

  logger.info(`Aggregated playback data for ${results.length} songs.`);
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(async () => {
      await runPlaybackAggregationJob();
    })
    .finally(async () => {
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    })
    .catch((error) => {
      logger.error('Playback aggregation failed:', error);
      process.exit(1);
    });
}
