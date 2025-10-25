import fs from "fs";
import path from "path";
import { s3 } from "../config/s3";
import { getChannel } from "../config/rabbitmq";
import { Song } from "../entities/Song";
import { transcodeToHLS } from "../utils/ffmpeg";
import { uploadFileToPinata, uploadJsonToPinata } from "../utils/ipfs";

import AppDataSource from "../config/db";
import { sendToBlockchain } from "../services/blockchainService";

export async function startWorker() {
  const channel = getChannel();

  await channel.assertQueue("song_processing");
  console.log("🎧 Worker ready. Listening for 'song_processing' jobs...");

  channel.consume("song_processing", async (msg) => {
    if (!msg) return;

    const { songId } = JSON.parse(msg.content.toString());
    console.log(` Processing song ${songId}`);

    try {
      const repo = AppDataSource.getRepository(Song);
      const song = await repo.findOneBy({ id: songId });
      if (!song) throw new Error("Song not found");

      // Step 1️: Download the file from S3
      const localFile = path.join("temp", `${songId}.mp3`);
      if (!fs.existsSync("temp")) fs.mkdirSync("temp");

      console.log(" Downloading from S3...");
      const s3Key = song.s3OriginalUrl.split(".amazonaws.com/")[1];
      const s3Stream = s3
        .getObject({
          Bucket: process.env.AWS_BUCKET_NAME!,
          Key: s3Key,
        })
        .createReadStream();

      const file = fs.createWriteStream(localFile);
      await new Promise<void>((resolve, reject) => {
        s3Stream.pipe(file)
          .on("finish", () => resolve())
          .on("error", (err) => reject(err));
      });

      // Step 2️: Transcode to HLS
      console.log("🎞️ Transcoding to HLS...");
      const outputDir = path.join("temp", songId);
      await transcodeToHLS(localFile, outputDir);

      // Step 3️: Upload HLS files (master + segments) to Pinata
      console.log(" Uploading HLS files to IPFS...");
      
    //   const masterFilePath = path.join(outputDir, "master.m3u8");
    //   const upload = await uploadFileToPinata(masterFilePath);

      const upload = await uploadFileToPinata(outputDir); // Use this for full HLS folder upload

      const songCid = upload.cid;

      // Step 4️: Upload metadata to Pinata
      const metadata = {
        title: song.title,
        artistId: song.artistId,
        description: "Uploaded via AudioBlocks",
        audio: `ipfs://${songCid}`,
        uploadedAt: new Date().toISOString(),
      };

      const metaUpload = await uploadJsonToPinata(metadata);
      const metadataCid = metaUpload.cid;

      // Step 5️: Update DB
      await repo.update(songId, {
        ipfsCid: songCid,
        metadataCid,
        status: "ready",
      });

      console.log(` Song ${songId} ready! CID: ${songCid}`);

      // Step 6️⃣: Send metadata CID to blockchain
      await sendToBlockchain(song.artistId, metadataCid);

      // Cleanup
      fs.unlinkSync(localFile);
      fs.rmSync(outputDir, { recursive: true, force: true });

      channel.ack(msg);
    } catch (error) {
      console.error(" Worker error:", error);
      channel.nack(msg, false, false); // discard bad message
    }
  });
}
