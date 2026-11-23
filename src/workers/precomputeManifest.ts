import AWS from 'aws-sdk';
import AppDataSource from '../config/db';
import { Song } from '../entities/Song';
import redis from '../config/redis';
import { AppError, ErrorType } from '../errors/AppError';

const s3 = new AWS.S3({ region: process.env.AWS_REGION });

export const DEFAULT_MANIFEST_CACHE_TTL = 300; // seconds (5 minutes)
export const DEFAULT_SIGNED_URL_EXPIRES = 600; // seconds (10 minutes) — strictly exceeds cache TTL (#828)

/**
 * Typed error thrown when an HLS manifest cannot be found or loaded (#828).
 */
export class ManifestNotFoundError extends AppError {
  constructor(message: string = 'No HLS manifest for song') {
    super(message, ErrorType.NOT_FOUND, 404, true, undefined, 'MANIFEST_NOT_FOUND');
    this.name = 'ManifestNotFoundError';
    Object.setPrototypeOf(this, ManifestNotFoundError.prototype);
  }
}

/**
 * Returns the cache TTL for precomputed manifests.
 */
export function getManifestCacheTtl(): number {
  return Number(process.env.MANIFEST_CACHE_TTL || DEFAULT_MANIFEST_CACHE_TTL);
}

/**
 * Returns the signed URL expiry in seconds.
 * Strictly enforces that signed URL expiry exceeds manifest cache TTL (#828)
 * so that cached manifests never contain expired segment URLs.
 */
export function getSignedUrlExpiry(): number {
  const configured = Number(process.env.SIGNED_URL_EXPIRES || DEFAULT_SIGNED_URL_EXPIRES);
  const cacheTtl = getManifestCacheTtl();
  if (configured <= cacheTtl) {
    return cacheTtl + 300;
  }
  return configured;
}

export const CACHE_TTL = DEFAULT_MANIFEST_CACHE_TTL;
export const SIGNED_EXPIRES = DEFAULT_SIGNED_URL_EXPIRES;

export function getSignedUrl(key: string, expiry: number = getSignedUrlExpiry()): string {
  return s3.getSignedUrl('getObject', {
    Bucket: process.env.AWS_BUCKET_NAME!,
    Key: key,
    Expires: expiry,
  });
}

export function s3KeyFromUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    throw new ManifestNotFoundError('Invalid S3 URL');
  }

  try {
    const parsed = new URL(url);
    const key = parsed.pathname.replace(/^\/+/, '');
    if (!key) throw new Error('Empty path');
    return key;
  } catch {
    const parts = url.split('.com/');
    if (parts.length < 2 || !parts[1]) {
      throw new ManifestNotFoundError(`Invalid S3 URL: ${url}`);
    }
    return parts[1].replace(/^\/+/, '');
  }
}

/**
 * Rewrites an HLS manifest (both master playlist with variants and single media playlist).
 * Preserves comments and tag lines (lines starting with #) unchanged.
 * Replaces each segment / variant playlist URI line with a presigned S3 URL.
 */
export async function rewriteManifest(manifest: string, songId: string): Promise<string> {
  const lines = manifest.split('\n');
  const rewrittenLines = await Promise.all(
    lines.map(async (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line; // comment, metadata, or tag

      let key: string;
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        key = s3KeyFromUrl(trimmed);
      } else {
        const cleanPath = trimmed.replace(/^\.?\//, '');
        if (cleanPath.startsWith(`songs/${songId}/hls/`)) {
          key = cleanPath;
        } else {
          key = `songs/${songId}/hls/${cleanPath}`;
        }
      }

      return getSignedUrl(key);
    }),
  );
  return rewrittenLines.join('\n');
}

export async function precomputeSignedManifest(songId: string): Promise<string> {
  const songRepo = AppDataSource.getRepository(Song);
  const song = await songRepo.findOneBy({ id: songId });

  if (!song || !song.hlsMasterUrl) {
    throw new ManifestNotFoundError(`No HLS manifest for song ${songId}`);
  }

  const masterKey = s3KeyFromUrl(song.hlsMasterUrl);

  let masterObj: AWS.S3.GetObjectOutput;
  try {
    masterObj = await s3
      .getObject({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: masterKey,
      })
      .promise();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    throw new ManifestNotFoundError(`Source manifest not found in storage: ${message}`);
  }

  if (!masterObj.Body) {
    throw new ManifestNotFoundError(`Empty manifest retrieved for song ${songId}`);
  }

  const manifest = masterObj.Body.toString('utf-8');
  const signedManifest = await rewriteManifest(manifest, songId);

  const cacheTtl = getManifestCacheTtl();
  await redis.setex(`manifest:${songId}`, cacheTtl, signedManifest);
  return signedManifest;
}
