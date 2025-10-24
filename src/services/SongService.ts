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
    private userRepo: Repository<User>;

    constructor() {
        this.songRepo = AppDataSource.getRepository(Song);
        this.userRepo = AppDataSource.getRepository(User);
        dotenv.config();
    }


    /**
   * Save an uploaded chunk to the temporary folder
   */
    async saveChunk(fileId: string, chunkIndex: number, tempFilePath: string): Promise<void> {
        const dir = path.join("uploads/temp", fileId);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.renameSync(tempFilePath, path.join(dir, `chunk_${chunkIndex}`));
    }

     /**
   * Merge all chunks, upload to S3, save song record, and queue processing
   */
  async finalizeUpload(fileId: string, totalChunks: number, title: string, artistId: string, artistAddress: string): Promise<Song> {
    const tempDir = path.join("uploads/temp", fileId);
    const mergedDir = "uploads/merged";
    const finalPath = path.join(mergedDir, `${fileId}.mp3`);

    if (!fs.existsSync(mergedDir)) fs.mkdirSync(mergedDir, { recursive: true });

    // 🔹 Merge all chunks into one file
    const writeStream = fs.createWriteStream(finalPath);
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(tempDir, `chunk_${i}`);
      const data = fs.readFileSync(chunkPath);
      writeStream.write(data);
      fs.unlinkSync(chunkPath);
    }
    writeStream.end();

    // 🔹 Upload merged file to S3
    const s3Res = await s3
      .upload({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: `uploads/${fileId}.mp3`,
        Body: fs.createReadStream(finalPath),
      })
      .promise();

    //  Save song record to DB
    const song = this.songRepo.create({
      title,
      artistAddress,
      artistId,
      s3OriginalUrl: s3Res.Location,
      status: "processing",
    });
    await this.songRepo.save(song);

    // 🔹 Send song for background processing via RabbitMQ
    const channel = getChannel();
    channel.sendToQueue(
      "song_processing",
      Buffer.from(JSON.stringify({ songId: song.id }))
    );

    // Optional cleanup
    fs.unlinkSync(finalPath);

    return song;
  }

    


}