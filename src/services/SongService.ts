import { Repository } from "typeorm";
import { Song } from "../entities/Song";
import { User } from "../entities/User";
import AppDataSource from "../config/db";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { s3 } from "../config/s3";
import { getChannel } from "../config/rabbitmq";

export class SongService {
  private songRepo: Repository<Song>;

  constructor() {
    this.songRepo = AppDataSource.getRepository(Song);
    dotenv.config();
  }

  /**
   * Save an uploaded chunk to the temporary folder
   */
  // async saveChunk(
  //   fileId: string,
  //   chunkIndex: number,
  //   tempFilePath: string
  // ): Promise<void> {
  //   const dir = path.join("uploads/temp", fileId);
  //   if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  //   fs.renameSync(tempFilePath, path.join(dir, `chunk_${chunkIndex}`));
  // }

  async saveChunk(fileId: string, chunkIndex: number, chunkPath: string) {
    const uploadDir = path.join("uploads", "temp", fileId);

    console.log("Saving chunk to:", uploadDir);

    // Ensure folder exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const destination = path.join(uploadDir, `chunk_${chunkIndex}`);
    // fs.renameSync(chunkPath, destination);
    fs.copyFileSync(chunkPath, destination);
    fs.unlinkSync(chunkPath);

    return destination;
  }

  async saveCover(fileId: string, coverPath: string) {
    const coverBuffer = fs.readFileSync(coverPath);
    const coverFileName = `${fileId}_cover.png`;

    const s3Res = await s3
      .upload({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: `covers/${coverFileName}`,
        Body: coverBuffer,
        ContentType: "image/png",
        // ACL: "public-read",
      })
      .promise();

    fs.unlinkSync(coverPath); // cleanup local temp

    return s3Res.Location; // the S3 URL for the cover
  }

  /**
   * Merge all chunks, upload to S3, save song record, and queue processing
   */
  async finalizeUpload(
    fileId: string,
    totalChunks: number,
    title: string,
    artistId: string,
    artistAddress: string,
    description: string,
    genre: string,
    coverArtPath: string
  ): Promise<Song> {
    const tempDir = path.join("uploads/temp", fileId);
    const mergedDir = "uploads/merged";
    const finalPath = path.join(mergedDir, `${fileId}.mp3`);

    // Ensure merged directory exists
    if (!fs.existsSync(mergedDir)) {
      fs.mkdirSync(mergedDir, { recursive: true });
    }

    //  Ensure folder exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Verify all chunks are present
    if (!fs.existsSync(tempDir)) {
      throw new Error(`Temp directory not found for fileId: ${fileId}`);
    }

    const chunkFiles = fs.readdirSync(tempDir);
    if (chunkFiles.length !== totalChunks) {
      throw new Error(
        `Expected ${totalChunks} chunks but found ${chunkFiles.length}`
      );
    }

    // if (!fs.existsSync(mergedDir)) fs.mkdirSync(mergedDir, { recursive: true });

    //  Merge all chunks into one file
    // const writeStream = fs.createWriteStream(finalPath);
    // for (let i = 0; i < totalChunks; i++) {
    //   const chunkPath = path.join(tempDir, `chunk_${i}`);
    //   const data = fs.readFileSync(chunkPath);
    //   writeStream.write(data);
    //   fs.unlinkSync(chunkPath);
    // }
    // writeStream.end();

    // Merge all chunks into one file with proper stream handling
    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(finalPath);

      writeStream.on("error", reject);
      writeStream.on("finish", resolve);

      // Write chunks sequentially
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(tempDir, `chunk_${i}`);
        const data = fs.readFileSync(chunkPath);
        writeStream.write(data);
        fs.unlinkSync(chunkPath); // Delete chunk after writing
      }

      writeStream.end();
    });

    // Remove empty temp directory
    fs.rmdirSync(tempDir);



    //  Upload merged file to S3
    const s3Res = await s3
      .upload({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: `uploads/${fileId}.mp3`,
        Body: fs.createReadStream(finalPath),
        ContentType: "audio/mpeg"
        // ACL: "public-read",
      })
      .promise();

    //  Save song record to DB
    const song = this.songRepo.create({
      title,
      artistAddress,
      artistId,
      s3OriginalUrl: s3Res.Location,
      status: "processing",
      description,
      genre,
      coverArtPath,
    });
    await this.songRepo.save(song);

    //  Send song for background processing via RabbitMQ
    const channel = getChannel();
    if (channel) {
      channel.sendToQueue(
        "song_processing",
        Buffer.from(JSON.stringify({ songId: song.id, fileId }))
      );
    }

    // Optional cleanup
    // fs.unlinkSync(finalPath);

    return song;
  }
}
