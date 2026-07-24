/**
 * Song Processor Worker (Issue #36)
 *
 * Retry / back-off policy for failed transcode and IPFS-pin jobs
 * ──────────────────────────────────────────────────────────────
 * Each message carries an optional `attempt` counter (injected below on
 * re-queue).  When processing fails the worker follows this policy:
 *
 *   1. If attempt < WORKER_MAX_ATTEMPTS, the message is nack'd and
 *      re-published after an exponential back-off delay:
 *        delay = WORKER_BACKOFF_BASE_MS * 2^(attempt - 1)
 *        capped at WORKER_BACKOFF_MAX_MS
 *
 *   2. Once all retries are exhausted the job is moved to the
 *      dead-letter queue ("song_processing_dlq") AND a SONG_FAILED
 *      entry is written to TransactionLog for operator visibility.
 *
 * Configuration (env vars, documented in .env.example):
 *   WORKER_MAX_ATTEMPTS       – max processing attempts  (default: 3)
 *   WORKER_BACKOFF_BASE_MS    – base delay in ms          (default: 2000)
 *   WORKER_BACKOFF_MAX_MS     – ceiling delay in ms       (default: 30000)
 */
import { SongService } from './../services/SongService';
import fs from "fs";
import path from "path";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import axios from "axios";
import { getChannel } from "../config/rabbitmq";
import { s3 } from "../config/s3";
import { CacheService } from "../services/CacheService";
import AppDataSource from "../config/db";
import { Song } from "../entities/Song";
import { PinataService } from "../services/PinataService";
import { precomputeSignedManifest } from "./precomputeManifest";
import { TransactionLogService } from '../services/TransactionLogService';
import { SearchIndexService } from "../services/SearchIndexService";
import logger from "../config/logger";

const MAIN_QUEUE = "song_processing";
const DLQ = "song_processing_dlq";

const MAX_ATTEMPTS = parseInt(process.env.WORKER_MAX_ATTEMPTS || "3", 10);
const BACKOFF_BASE_MS = parseInt(process.env.WORKER_BACKOFF_BASE_MS || "2000", 10);
const BACKOFF_MAX_MS = parseInt(process.env.WORKER_BACKOFF_MAX_MS || "30000", 10);

const songRepo = AppDataSource.getRepository(Song);

/** Compute exponential back-off delay (capped). */
function backoffDelay(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt - 1), BACKOFF_MAX_MS);
}

export async function startSongWorker() {
  try {
    const channel = getChannel();

    const SongServiceInstance = new SongService();
    const logService = new TransactionLogService();

    // Assert main queue and dead-letter queue before consuming.
    await channel.assertQueue(MAIN_QUEUE, { durable: true });
    await channel.assertQueue(DLQ, { durable: true });

    logger.info(`🎵 Waiting for messages in queue: ${MAIN_QUEUE} (max attempts: ${MAX_ATTEMPTS})`);

    channel.consume(MAIN_QUEUE, async (msg) => {
      if (!msg) return;

      let payload: { songId: string; fileId: string; attempt?: number };
      try {
        payload = JSON.parse(msg.content.toString());
      } catch {
        // Malformed message — discard permanently
        logger.error({ raw: msg.content.toString() }, "Malformed queue message, discarding");
        channel.nack(msg, false, false);
        return;
      }

      const { songId, fileId } = payload;
      const attempt = payload.attempt ?? 1;
      const logCtx = { songId, fileId, attempt };

      logger.info(logCtx, `Processing song (attempt ${attempt}/${MAX_ATTEMPTS})`);

      try {
        const data = JSON.parse(msg.content.toString());

        const song = await songRepo.findOne({
          where: { id: songId },
          relations: ["user"],
        });
        if (!song) throw new Error("Song not found");

        const localFile = path.join("uploads/merged", `${fileId}.mp3`);
        const hlsDir = `uploads/hls/${fileId}`;

        if (!fs.existsSync(hlsDir)) fs.mkdirSync(hlsDir, { recursive: true });

        // Transcode to HLS
        await new Promise((resolve, reject) => {
          ffmpeg(localFile)
            .outputOptions([
              "-codec: copy",
              "-start_number 0",
              "-hls_time 10",
              "-hls_list_size 0",
              "-f hls",
            ])
            .output(path.join(hlsDir, "master.m3u8"))
            .on("end", resolve)
            .on("error", reject)
            .run();
        });

        // Upload HLS to S3
        const hlsFiles = fs.readdirSync(hlsDir);
        const s3BasePath = `songs/${songId}/hls/`;

        for (const f of hlsFiles) {
          const filePath = path.join(hlsDir, f);
          await s3
            .upload({
              Bucket: process.env.AWS_BUCKET_NAME!,
              Key: `${s3BasePath}${f}`,
              Body: fs.createReadStream(filePath),
            })
            .promise();
        }

        const masterUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${s3BasePath}master.m3u8`;
        const tempCoverPath = path.join(os.tmpdir(), `${fileId}-cover.jpg`);
        const coverResponse = await axios.get<ArrayBuffer>(song.coverArtPath, {
          responseType: "arraybuffer",
        });
        fs.writeFileSync(tempCoverPath, Buffer.from(coverResponse.data));

        const coverRes = await PinataService.uploadFile(
          tempCoverPath,
          `${songId}-cover.jpg`
        );

        const metadata = {
          name: song.title,
          artist: song.artistAddress,
          description: song.description,
          image: `ipfs://${coverRes.cid}`,
          animation_url: masterUrl,
          attributes: [
            { trait_type: "duration", value: song.duration || 0 },
            { trait_type: "loudness", value: song.loudness || 0 },
            { trait_type: "genre", value: song.genre },
            { trait_type: "cover_url", value: coverRes.cid },
            { trait_type: "artist_name", value: song?.user.name },
            { trait_type: "artist_username", value: song?.user.username },
            { trait_type: "Composers", value: song.composers || "" },
          ],
        };

        const metadataRes = await PinataService.uploadJSON(
          metadata,
          `${songId}-metadata.json`
        );

        // Update song record
        song.status = "ready";
        song.hlsMasterUrl = masterUrl;
        song.metadataCid = metadataRes.cid;
        song.metadata = metadata;
        await songRepo.save(song);

        await precomputeSignedManifest(song.id).catch((err) =>
          logger.warn({ err }, "precompute failed")
        );

        await CacheService.cacheSong(songId, song);

        // Song is now live and searchable — update the precomputed search
        // index asynchronously (Issue #135).
        SearchIndexService.scheduleIndexUpdate(song);

        await logService.createLogEntry(
          song.user.id,
          "",
          "SONG_PROCESSED",
          `Song with ID ${song.id} has been processed and is live. Awaiting artist signature to mint.`
        );

        fs.unlinkSync(localFile);
        fs.rmdirSync(hlsDir, { recursive: true });

        channel.ack(msg);
        logger.info(logCtx, "Song processed successfully");

      } catch (err) {
        logger.error({ ...logCtx, err }, `Song processing failed on attempt ${attempt}`);

        if (attempt < MAX_ATTEMPTS) {
          // Re-queue with incremented attempt counter after back-off
          const delay = backoffDelay(attempt);
          logger.warn(logCtx, `Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);

          setTimeout(() => {
            try {
              channel.publish(
                "",
                MAIN_QUEUE,
                Buffer.from(JSON.stringify({ songId, fileId, attempt: attempt + 1 })),
                { persistent: true }
              );
            } catch (publishErr) {
              logger.error({ ...logCtx, err: publishErr }, "Failed to re-queue message");
            }
          }, delay);

          // Ack the original so it doesn't block the queue while we wait
          channel.ack(msg);
        } else {
          // All attempts exhausted — send to DLQ and log for visibility
          logger.error(logCtx, `Song ${songId} failed after ${MAX_ATTEMPTS} attempts, moving to DLQ`);

          channel.publish(
            "",
            DLQ,
            Buffer.from(JSON.stringify({ songId, fileId, attempt, error: String(err) })),
            { persistent: true }
          );

          // Log failure to TransactionLog so operators can investigate
          try {
            const song = await songRepo.findOne({ where: { id: songId }, relations: ["user"] });
            if (song?.user?.id) {
              const logService = new TransactionLogService();
              await logService.createLogEntry(
                song.user.id,
                "",
                "SONG_FAILED",
                `Song ${songId} failed processing after ${MAX_ATTEMPTS} attempts. Moved to DLQ. Error: ${String(err)}`
              );
            }
          } catch (logErr) {
            logger.error({ songId, err: logErr }, "Failed to write SONG_FAILED log entry");
          }

          channel.ack(msg);
        }
      }
    });
  } catch (error) {
    logger.error({ err: error }, "❌ Could not start song worker");
    logger.warn("⚠️ Worker will retry when RabbitMQ reconnects");
  }
}
