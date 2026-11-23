import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import os from 'os';
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

export interface LoudnessAnalysis {
  integratedLoudness: number; // LUFS
  truePeak: number; // dBTP
  loudnessRange: number; // LRA
}

/**
 * Measure loudness (EBU R128) of an audio file using ffmpeg.
 * Returns integrated loudness (LUFS), true peak (dBTP), and loudness range (LRA).
 * Issue #769: Populates Song.loudness, truePeakDb, and loudnessRange columns.
 *
 * @param inputPath - Path to the audio file to analyze.
 * @returns Loudness analysis results.
 * @throws {Error} If analysis fails or ffmpeg errors.
 */
export async function analyzeLoudness(inputPath: string): Promise<LoudnessAnalysis> {
  return new Promise((resolve, reject) => {
    let ffmpegOutput = '';

    ffmpeg(inputPath)
      .audioFilters('loudnorm=print_format=json')
      .outputOptions(['-f', 'null'])
      .output('-')
      .on('stderr', (line: string) => {
        ffmpegOutput += line + '\n';
      })
      .on('end', () => {
        try {
          // ffmpeg prints loudnorm output as JSON in stderr after the analysis
          const jsonMatch = ffmpegOutput.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error('Could not find loudnorm JSON output');
          }

          const data = JSON.parse(jsonMatch[0]);
          resolve({
            integratedLoudness: parseFloat(data.input_i),
            truePeak: parseFloat(data.input_tp),
            loudnessRange: parseFloat(data.input_lra),
          });
        } catch (error) {
          reject(
            new Error(
              `Failed to parse loudness analysis: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      })
      .on('error', (err) => {
        reject(new Error(`Loudness analysis failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Generate waveform peak data for visualization (Issue #771).
 * Uses ffmpeg to extract audio samples and calculates peak values at regular intervals.
 * Returns an array of normalized peak values (0.0 to 1.0) suitable for client-side rendering.
 *
 * @param inputPath - Path to the audio file.
 * @param samples - Number of peak samples to generate (default: 200).
 * @returns Array of normalized peak values.
 */
export async function generateWaveformPeaks(
  inputPath: string,
  samples: number = 200,
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(os.tmpdir(), `waveform-${Date.now()}.dat`);

    ffmpeg(inputPath)
      .audioFilters(`compand,showwavespic=s=${samples}x100:colors=white`)
      .outputOptions(['-frames:v', '1', '-f', 'image2'])
      .output(tempFile)
      .on('end', () => {
        try {
          // Read the generated waveform image and extract peak data
          // For simplicity, we'll use astats filter instead to get actual audio data
          fs.unlinkSync(tempFile);

          // Use a different approach: extract raw audio data and calculate peaks
          extractAudioPeaks(inputPath, samples).then(resolve).catch(reject);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (err) => {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        reject(new Error(`Waveform generation failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Extract audio peaks by analyzing the raw audio data.
 */
async function extractAudioPeaks(inputPath: string, samples: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const tempPcm = path.join(os.tmpdir(), `audio-${Date.now()}.pcm`);

    // Convert to mono 16-bit PCM
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(44100)
      .format('s16le')
      .output(tempPcm)
      .on('end', () => {
        try {
          const buffer = fs.readFileSync(tempPcm);
          const peaks: number[] = [];
          const chunkSize = Math.floor(buffer.length / (samples * 2)); // 2 bytes per sample

          for (let i = 0; i < samples; i++) {
            const start = i * chunkSize * 2;
            const end = Math.min(start + chunkSize * 2, buffer.length);
            let maxPeak = 0;

            // Find max absolute value in this chunk
            for (let j = start; j < end; j += 2) {
              if (j + 1 < buffer.length) {
                const sample = buffer.readInt16LE(j);
                const normalized = Math.abs(sample) / 32768.0;
                maxPeak = Math.max(maxPeak, normalized);
              }
            }

            peaks.push(Math.min(1.0, maxPeak));
          }

          fs.unlinkSync(tempPcm);
          resolve(peaks);
        } catch (error) {
          if (fs.existsSync(tempPcm)) {
            fs.unlinkSync(tempPcm);
          }
          reject(error);
        }
      })
      .on('error', (err) => {
        if (fs.existsSync(tempPcm)) {
          fs.unlinkSync(tempPcm);
        }
        reject(new Error(`Audio peak extraction failed: ${err.message}`));
      })
      .run();
  });
}

export async function transcodeToHLS(
  inputPath: string,
  outputDir: string,
  songId?: string,
): Promise<void> {
  try {
    fs.mkdirSync(outputDir, { recursive: true });

    const bitrates = [
      { bitrate: '64k', name: '64' },
      { bitrate: '128k', name: '128' },
      { bitrate: '256k', name: '256' },
    ];

    // Generate each bitrate rendition
    for (const { bitrate, name } of bitrates) {
      await new Promise<void>((resolve, reject) => {
        const variantDir = path.join(outputDir, name);
        fs.mkdirSync(variantDir, { recursive: true });

        ffmpeg(inputPath)
          .outputOptions([
            '-vn',
            '-c:a aac',
            `-b:a ${bitrate}`,
            '-ar 44100',
            '-start_number 0',
            '-hls_time 10',
            '-hls_list_size 0',
            '-hls_segment_type fmp4',
            '-hls_segment_filename',
            path.join(variantDir, `segment_%03d.m4s`),
            '-f hls',
          ])
          .output(path.join(variantDir, 'playlist.m3u8'))
          .on('end', () => resolve())
          .on('error', (err, _stdout, stderr) =>
            reject(new TranscodeError(err.message, stderr ?? '')),
          )
          .run();
      });
      logger.info({ songId, bitrate }, `HLS variant ${bitrate} transcoding complete`);
    }

    // Create master playlist
    const masterPlaylist = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.2"
64/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"
128/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=256000,CODECS="mp4a.40.2"
256/playlist.m3u8
`;
    fs.writeFileSync(path.join(outputDir, 'master.m3u8'), masterPlaylist);

    logger.info({ songId, outputDir }, 'HLS adaptive bitrate transcoding complete');
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
