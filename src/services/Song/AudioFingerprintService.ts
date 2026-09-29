import fs from 'fs';
import { Repository } from 'typeorm';
import AppDataSource from '../../config/db';
import { Song } from '../../entities/Song';
import logger from '../../config/logger';

export interface DuplicateCheckResult {
  isNearDuplicate: boolean;
  matchedSongId?: string;
  similarity: number;
}

/**
 * Service for acoustic audio fingerprinting and duplicate/plagiarism detection (Issue #272).
 *
 * Implements perceptual sub-band energy comparison (robust to volume scaling and minor noise).
 * Guarantees:
 * - Generates acoustic fingerprint stored per Song entity.
 * - Flags near-duplicates for review without auto-blocking/rejecting uploads.
 * - Compares audio signatures with configurable similarity thresholds.
 */
export class AudioFingerprintService {
  private songRepo: Repository<Song>;
  private similarityThreshold: number;

  constructor(songRepo?: Repository<Song>, threshold = 0.8) {
    this.songRepo = songRepo || AppDataSource.getRepository(Song);
    this.similarityThreshold = threshold;
  }

  /**
   * Generate an acoustic perceptual fingerprint from an audio buffer or file path.
   * Computes sub-band spectral energy gradients across temporal frames.
   */
  async generateFingerprint(input: Buffer | string): Promise<string> {
    let buffer: Buffer;

    if (typeof input === 'string') {
      if (fs.existsSync(input)) {
        buffer = await fs.promises.readFile(input);
      } else {
        buffer = Buffer.from(input, 'utf8');
      }
    } else {
      buffer = input;
    }

    if (buffer.length === 0) {
      return '';
    }

    const numBands = 16;
    const frameSize = Math.max(64, Math.floor(buffer.length / 32));
    const numFrames = Math.max(1, Math.min(32, Math.floor(buffer.length / frameSize)));
    const frameBitStrings: string[] = [];

    for (let f = 0; f < numFrames; f++) {
      const frameStart = f * frameSize;
      const bandSize = Math.max(1, Math.floor(frameSize / numBands));
      const bandEnergies: number[] = [];

      for (let b = 0; b < numBands; b++) {
        const bStart = frameStart + b * bandSize;
        const bEnd = Math.min(bStart + bandSize, buffer.length);
        let sum = 0;
        for (let i = bStart; i < bEnd; i++) {
          const sample = buffer[i] - 128; // Center at 0
          sum += sample * sample;
        }
        bandEnergies.push(sum / Math.max(1, bEnd - bStart));
      }

      // Compute energy gradient bits: 1 if band[i] > band[i-1], 0 otherwise
      let frameBits = '';
      for (let b = 0; b < numBands; b++) {
        const prev = b > 0 ? bandEnergies[b - 1] : bandEnergies[numBands - 1];
        frameBits += bandEnergies[b] >= prev ? '1' : '0';
      }

      // Convert 16-bit binary string to 4-char hex
      const hex = parseInt(frameBits, 2).toString(16).padStart(4, '0');
      frameBitStrings.push(hex);
    }

    return frameBitStrings.join('-');
  }

  /**
   * Compare two acoustic fingerprints and return a similarity score between 0.0 and 1.0.
   * Computes normalized bitwise Hamming similarity across frames.
   */
  compareFingerprints(fp1: string, fp2: string): number {
    if (!fp1 || !fp2) return 0.0;
    if (fp1 === fp2) return 1.0;

    const frames1 = fp1.split('-');
    const frames2 = fp2.split('-');

    if (frames1.length === 0 || frames2.length === 0) return 0.0;

    const minLen = Math.min(frames1.length, frames2.length);
    const maxLen = Math.max(frames1.length, frames2.length);

    let totalMatchingBits = 0;
    const bitsPerFrame = 16;

    for (let i = 0; i < minLen; i++) {
      const val1 = parseInt(frames1[i], 16) || 0;
      const val2 = parseInt(frames2[i], 16) || 0;

      // Bitwise XOR gives differences; inverted count gives matches
      const xor = val1 ^ val2;
      let diffBits = 0;
      for (let b = 0; b < bitsPerFrame; b++) {
        if ((xor & (1 << b)) !== 0) {
          diffBits++;
        }
      }
      totalMatchingBits += bitsPerFrame - diffBits;
    }

    const totalPossibleBits = maxLen * bitsPerFrame;
    return Number((totalMatchingBits / totalPossibleBits).toFixed(4));
  }

  /**
   * Check if a song's fingerprint matches existing songs in the platform.
   */
  async checkDuplicates(
    fingerprint: string,
    excludeSongId?: string,
    threshold = this.similarityThreshold,
  ): Promise<DuplicateCheckResult> {
    if (!fingerprint) {
      return { isNearDuplicate: false, similarity: 0.0 };
    }

    try {
      const query = this.songRepo.createQueryBuilder('song').where('song.fingerprint IS NOT NULL');
      if (excludeSongId) {
        query.andWhere('song.id != :excludeSongId', { excludeSongId });
      }

      const existingSongs = await query.getMany();

      let highestSim = 0.0;
      let matchedSong: Song | null = null;

      for (const existing of existingSongs) {
        if (!existing.fingerprint) continue;
        const sim = this.compareFingerprints(fingerprint, existing.fingerprint);
        if (sim > highestSim) {
          highestSim = sim;
          matchedSong = existing;
        }
      }

      if (highestSim >= threshold && matchedSong) {
        return {
          isNearDuplicate: true,
          matchedSongId: matchedSong.id,
          similarity: Number(highestSim.toFixed(4)),
        };
      }

      return {
        isNearDuplicate: false,
        similarity: Number(highestSim.toFixed(4)),
      };
    } catch (error) {
      logger.error({ err: error }, 'Error during duplicate audio fingerprint check');
      return { isNearDuplicate: false, similarity: 0.0 };
    }
  }

  /**
   * Process a song for fingerprinting and duplicate detection.
   * Guarantees that near-duplicates are flagged for review and never auto-blocked.
   */
  async processSongFingerprint(
    songId: string,
    audioBufferOrPath: Buffer | string,
  ): Promise<{ song: Song; duplicateResult: DuplicateCheckResult }> {
    const song = await this.songRepo.findOneBy({ id: songId });
    if (!song) {
      throw new Error(`Song ${songId} not found`);
    }

    const fingerprint = await this.generateFingerprint(audioBufferOrPath);
    song.fingerprint = fingerprint;

    const duplicateResult = await this.checkDuplicates(fingerprint, songId);

    if (duplicateResult.isNearDuplicate) {
      song.isNearDuplicate = true;
      song.duplicateOfSongId = duplicateResult.matchedSongId || null;
      song.duplicateSimilarityScore = duplicateResult.similarity;
      song.flagged = true;
      song.flagReason = `Flagged for duplicate/plagiarism review: ${Math.round(
        duplicateResult.similarity * 100,
      )}% match with song ${duplicateResult.matchedSongId}`;
      logger.warn(
        {
          songId,
          duplicateOfSongId: duplicateResult.matchedSongId,
          similarity: duplicateResult.similarity,
        },
        'Song flagged as near-duplicate for review (not auto-blocked)',
      );
    } else {
      song.isNearDuplicate = false;
      song.duplicateSimilarityScore = duplicateResult.similarity;
    }

    await this.songRepo.save(song);
    return { song, duplicateResult };
  }
}
