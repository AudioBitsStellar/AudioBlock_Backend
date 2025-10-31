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

const songRepo = AppDataSource.getRepository(Song);

export async function startSongWorker() {
  const channel = getChannel();

  const queue = "song_processing";

  // Ensure the queue exists before consuming
  await channel.assertQueue(queue, { durable: true });
  console.log(`🎵 Waiting for messages in queue: ${queue}`);

  channel.consume(queue, async (msg) => {
    if (!msg) return;

    try {
      //   const song = await songRepo.findOneBy({ id: songId });
      const { songId, fileId } = JSON.parse(msg.content.toString());
      console.log(`Processing song ${songId}`);

      const data = JSON.parse(msg.content.toString());
      console.log("🎧 Received message:", data);

      const song = await songRepo.findOne({
        where: { id: songId },
        relations: ["user"], // load the related user (artist)
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
      const s3BasePath = `songs/${fileId}/hls/`;

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
      fs.writeFileSync(
        tempCoverPath,
        Buffer.from(new Uint8Array(coverResponse.data))
      );
      fs.writeFileSync(tempCoverPath, Buffer.from(coverResponse.data));

      const coverRes = await PinataService.uploadFile(
        tempCoverPath,
        `${songId}-cover.jpg`
      );

      // Upload metadata + cover to IPFS
      // const coverRes = await PinataService.uploadFile(song.coverArtPath, `${fileId}-cover.jpg`);
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
          { trait_type: "Composers", value: "" },
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

      await CacheService.cacheSong(songId, song);

      fs.unlinkSync(localFile);
      fs.rmdirSync(hlsDir, { recursive: true });

      channel.ack(msg);
    } catch (err) {
      console.error("Worker error:", err);
      channel.nack(msg, false, false);
    }
  });
}
