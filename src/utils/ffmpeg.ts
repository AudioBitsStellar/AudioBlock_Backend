import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import logger from '../config/logger';

export class TranscodeError extends Error {
  readonly stderrTail: string;
  constructor(message: string, stderr: string = '') {
    super(message);
    this.name = 'TranscodeError';
    this.stderrTail = stderr.slice(-4096);
  }
}

const HLS_AUDIO_BITRATE = process.env.HLS_AUDIO_BITRATE || '256k';

export async function transcodeToHLS(
  inputPath: string,
  outputDir: string,
  songId?: string,
): Promise<void> {
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-vn',
          '-c:a aac',
          `-b:a ${HLS_AUDIO_BITRATE}`,
          '-ar 44100',
          '-start_number 0',
          '-hls_time 10',
          '-hls_list_size 0',
          '-hls_segment_type fmp4',
          '-f hls',
        ])
        .output(path.join(outputDir, 'master.m3u8'))
        .on('end', () => resolve())
        .on('error', (err, _stdout, stderr) =>
          reject(new TranscodeError(err.message, stderr ?? '')),
        )
        .run();
    });
    logger.info({ songId, outputDir }, 'HLS transcoding complete');
  } catch (err) {
    const error =
      err instanceof TranscodeError
        ? err
        : new TranscodeError(err instanceof Error ? err.message : String(err));
    logger.error(
      { songId, outputDir, err: error, stderrTail: error.stderrTail },
      'HLS transcoding failed',
    );
    throw error;
  }
}
