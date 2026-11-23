#!/usr/bin/env ts-node
/**
 * Backfill loudness measurements for existing songs (Issue #769).
 * Analyzes songs without loudness data and populates the loudness, truePeakDb,
 * and loudnessRange columns. Does NOT re-pin metadata for already-minted songs
 * because on-chain metadata is immutable.
 *
 * Usage: npm run backfill:loudness
 */

import AppDataSource from '../src/config/db';
import { Song } from '../src/entities/Song';
import { analyzeLoudness } from '../src/utils/ffmpeg';
import logger from '../src/config/logger';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import * as os from 'os';

async function backfillLoudness() {
  await AppDataSource.initialize();
  const songRepo = AppDataSource.getRepository(Song);

  // Find songs without loudness data that are ready/minted
  const songs = await songRepo.find({
    where: [
      { loudness: null, status: 'ready' },
      { loudness: null, mintStatus: 'minted' },
    ],
  });

  logger.info({ count: songs.length }, 'Starting loudness backfill');

  let processed = 0;
  let failed = 0;

  for (const song of songs) {
    try {
      logger.info({ songId: song.id, title: song.title }, 'Analyzing loudness');

      // Download the original file if needed
      let localPath: string;
      if (song.s3OriginalUrl) {
        const tempFile = path.join(os.tmpdir(), `backfill-${song.id}.mp3`);
        const response = await axios.get(song.s3OriginalUrl, {
          responseType: 'arraybuffer',
        });
        fs.writeFileSync(tempFile, Buffer.from(response.data));
        localPath = tempFile;
      } else {
        // Try local uploads directory
        localPath = path.join('uploads/merged', `${song.id}.mp3`);
        if (!fs.existsSync(localPath)) {
          logger.warn({ songId: song.id }, 'No source file found, skipping');
          failed++;
          continue;
        }
      }

      // Analyze loudness
      const loudnessData = await analyzeLoudness(localPath);
      song.loudness = loudnessData.integratedLoudness;
      song.truePeakDb = loudnessData.truePeak;
      song.loudnessRange = loudnessData.loudnessRange;
      await songRepo.save(song);

      // Clean up temp file
      if (song.s3OriginalUrl) {
        fs.unlinkSync(localPath);
      }

      processed++;
      logger.info(
        {
          songId: song.id,
          loudness: song.loudness,
          truePeak: song.truePeakDb,
          lra: song.loudnessRange,
        },
        'Loudness backfill complete',
      );
    } catch (error) {
      failed++;
      logger.error({ songId: song.id, err: error }, 'Loudness backfill failed');
    }
  }

  logger.info({ total: songs.length, processed, failed }, 'Loudness backfill complete');
  await AppDataSource.destroy();
}

backfillLoudness().catch((error) => {
  logger.error({ err: error }, 'Backfill script failed');
  process.exit(1);
});
