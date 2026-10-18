// import ffmpeg from "fluent-ffmpeg";
// import fs from "fs";
// import path from "path";

// export async function transcodeToHLS(inputPath: string, outputDir: string): Promise<void> {
//   if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

//   return new Promise((resolve, reject) => {
//     ffmpeg(inputPath)
//       .outputOptions([
//         "-codec: copy",
//         "-start_number 0",
//         "-hls_time 10",
//         "-hls_list_size 0",
//         "-f hls",
//       ])
//       .output(path.join(outputDir, "master.m3u8"))
//       .on("end", () => resolve())
//       .on("error", reject)
//       .run();
//   });
// }

import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from '../config/logger';

const execFileAsync = promisify(execFile);

export interface FfmpegAvailability {
  available: boolean;
  ffmpegVersion?: string;
  ffprobeVersion?: string;
  error?: string;
}

/**
 * Checks that both ffmpeg and ffprobe are reachable and returns their versions.
 * Respects FFMPEG_PATH / FFPROBE_PATH env overrides (fluent-ffmpeg convention).
 */
export async function checkFfmpegAvailability(): Promise<FfmpegAvailability> {
  const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe';

  // Apply path overrides to fluent-ffmpeg if provided
  if (process.env.FFMPEG_PATH) {
    ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
  }
  if (process.env.FFPROBE_PATH) {
    ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
  }

  try {
    const [ffmpegOut, ffprobeOut] = await Promise.all([
      execFileAsync(ffmpegBin, ['-version']),
      execFileAsync(ffprobeBin, ['-version']),
    ]);

    const ffmpegVersion = ffmpegOut.stdout.split('\n')[0] ?? 'unknown';
    const ffprobeVersion = ffprobeOut.stdout.split('\n')[0] ?? 'unknown';

    return { available: true, ffmpegVersion, ffprobeVersion };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { available: false, error: message };
  }
}

/**
 * Runs at worker startup. Logs a clear error with install instructions and
 * exits non-zero if ffmpeg or ffprobe is missing (fail fast).
 */
export async function assertFfmpegAvailable(): Promise<void> {
  const result = await checkFfmpegAvailability();

  if (!result.available) {
    logger.error(
      { error: result.error },
      [
        'ffmpeg or ffprobe not found. Song processing requires both binaries.',
        'Install instructions:',
        '  macOS:   brew install ffmpeg',
        '  Ubuntu:  sudo apt-get install -y ffmpeg',
        '  Alpine:  apk add ffmpeg',
        '  Windows: choco install ffmpeg',
        'You can also set FFMPEG_PATH / FFPROBE_PATH env vars to point to custom binaries.',
      ].join('\n'),
    );
    process.exit(1);
  }

  logger.info(
    { ffmpegVersion: result.ffmpegVersion, ffprobeVersion: result.ffprobeVersion },
    'ffmpeg availability check passed',
  );
}

/**
 * Transcodes an MP3 (or any audio) file into HLS format:
 * - Creates 10s .ts chunks
 * - Generates master.m3u8 playlist
 */
export async function transcodeToHLS(inputPath: string, outputDir: string): Promise<void> {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      // copy codec (no re-encoding — much faster)
      .outputOptions([
        '-codec: copy',
        '-start_number 0',
        '-hls_time 10', // 10s per segment
        '-hls_list_size 0', // include all segments
        '-f hls', // output format
      ])
      .output(path.join(outputDir, 'master.m3u8'))
      .on('end', () => {
        console.log('✅ HLS transcoding complete:', outputDir);
        resolve();
      })
      .on('error', (err) => {
        console.error('❌ FFmpeg error:', err);
        reject(err);
      })
      .run();
  });
}
