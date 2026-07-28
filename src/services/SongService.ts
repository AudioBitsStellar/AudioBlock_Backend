import { In, Repository } from 'typeorm';
import { Song } from '../entities/Song';
import { User } from '../entities/User';
import { TransactionLog } from '../entities/TransactionLog';
import { RoyaltyTemplate } from '../entities/RoyaltyTemplate';
import AppDataSource from '../config/db';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { s3 } from '../config/s3';
import { getChannel } from '../config/rabbitmq';
import { SorobanContracts } from '../config/soroban';
import { SorobanService, addressArg, stringArg, u64Arg } from './Soroban/SorobanService';
import { PreparedTransaction } from './Artist/ArtistService';
import { ScanService } from './ScanService';
import { SearchIndexService } from './SearchIndexService';
import { CacheService } from './CacheService';
import logger from '../config/logger';
import { songsUploadedTotal } from './MetricsService';

export class SongService {
  private songRepo: Repository<Song>;
  private userRepo: Repository<User>;
  private logRepo: Repository<TransactionLog>;
  private soroban: SorobanService;

  constructor() {
    this.songRepo = AppDataSource.getRepository(Song);
    this.userRepo = AppDataSource.getRepository(User);
    this.logRepo = AppDataSource.getRepository(TransactionLog);
    this.soroban = new SorobanService();
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

  /**
   * Save an uploaded audio chunk to the temporary upload directory.
   *
   * @param fileId - Unique identifier for the upload session (UUID).
   * @param chunkIndex - Zero-based index of this chunk in the sequence.
   * @param chunkPath - Absolute path to the temporary chunk file on disk.
   * @returns The destination path where the chunk was saved.
   */
  async saveChunk(fileId: string, chunkIndex: number, chunkPath: string) {
    const uploadDir = path.join('uploads', 'temp', fileId);

    logger.debug({ fileId, chunkIndex }, 'Saving chunk');

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

  /**
   * Upload cover art to S3 and return the public URL.
   *
   * @param fileId - Unique identifier for the upload session (UUID).
   * @param coverPath - Absolute path to the cover image file on disk.
   * @returns The S3 URL of the uploaded cover art.
   */
  async saveCover(fileId: string, coverPath: string) {
    const coverBuffer = fs.readFileSync(coverPath);
    const coverFileName = `${fileId}_cover.png`;

    const s3Res = await s3
      .upload({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: `covers/${coverFileName}`,
        Body: coverBuffer,
        ContentType: 'image/png',
        // ACL: "public-read",
      })
      .promise();

    fs.unlinkSync(coverPath); // cleanup local temp

    return s3Res.Location; // the S3 URL for the cover
  }

  /**
   * Apply a royalty template's splits to a song. Stores the split configuration
   * on the song for use during royalty payout calculation.
   *
   * @param songId - ID of the song to apply splits to.
   * @param templateId - ID of the royalty template to apply.
   * @throws {Error} If song or template not found, or user is not the song owner.
   */
  async applyTemplate(songId: string, templateId: string, userId: string): Promise<Song> {
    const song = await this.songRepo.findOneBy({ id: songId });
    if (!song) {
      throw Object.assign(new Error('Song not found'), { statusCode: 404 });
    }

    if (song.artistId !== userId) {
      throw Object.assign(new Error('Not authorized to modify this song'), { statusCode: 403 });
    }

    const templateRepo = AppDataSource.getRepository(RoyaltyTemplate);
    const template = await templateRepo.findOneBy({ id: templateId });
    if (!template) {
      throw Object.assign(new Error('Template not found'), { statusCode: 404 });
    }

    if (template.userId !== userId) {
      throw Object.assign(new Error('Not authorized to use this template'), { statusCode: 403 });
    }

    song.royaltySplits = template.splits;
    return this.songRepo.save(song);
  }

  /**
   * Merge all uploaded chunks, run a malware scan, upload to S3, persist the
   * song record, and enqueue background processing (HLS transcoding + IPFS pinning).
   *
   * @param fileId - Unique identifier for the upload session.
   * @param totalChunks - Expected number of chunks to merge.
   * @param title - Song title.
   * @param artistId - ID of the artist User record.
   * @param artistAddress - Ethereum wallet address of the artist.
   * @param description - Song description.
   * @param genre - Genre label.
   * @param coverArtPath - Path to the cover art image on disk.
   * @param composers - Comma-separated list of composer names.
   * @returns The persisted Song entity with status "processing".
   * @throws {Error} If chunk count mismatch, malware detected, or S3 upload fails.
   */
  async finalizeUpload(
    fileId: string,
    totalChunks: number,
    title: string,
    artistId: string,
    artistAddress: string,
    description: string,
    genre: string,
    coverArtPath: string,
    composers: string,
  ): Promise<Song> {
    const tempDir = path.join('uploads/temp', fileId);
    const mergedDir = 'uploads/merged';
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
      throw new Error(`Expected ${totalChunks} chunks but found ${chunkFiles.length}`);
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

      writeStream.on('error', reject);
      writeStream.on('finish', resolve);

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

    // ── Malware scan (Issue #38) ───────────────────────────────────────────────
    // Scan the merged file BEFORE uploading to S3 or queuing the worker.
    // Flagged files are deleted and the finalize call is aborted with a 422.
    logger.info({ fileId }, 'Running malware scan on merged upload');
    const scanResult = await ScanService.scanFile(finalPath);
    if (!scanResult.clean) {
      logger.warn({ fileId, threat: scanResult.threat }, 'Malware detected — rejecting upload');
      // Delete the merged file so nothing lands in S3
      try {
        fs.unlinkSync(finalPath);
      } catch {
        /* best-effort */
      }
      throw Object.assign(
        new Error(`Upload rejected: malware detected (${scanResult.threat ?? 'unknown threat'})`),
        { statusCode: 422, code: 'MALWARE_DETECTED', threat: scanResult.threat },
      );
    }
    logger.info({ fileId }, 'Malware scan passed');
    const s3Res = await s3
      .upload({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: `uploads/${fileId}.mp3`,
        Body: fs.createReadStream(finalPath),
        ContentType: 'audio/mpeg',
        // ACL: "public-read",
      })
      .promise();

    //  Save song record to DB
    const song = this.songRepo.create({
      title,
      artistAddress,
      artistId,
      s3OriginalUrl: s3Res.Location,
      status: 'processing',
      description,
      genre,
      coverArtPath,
      composers,
    });
    await this.songRepo.save(song);
    songsUploadedTotal.inc();

    //  Send song for background processing via RabbitMQ
    const channel = getChannel();
    if (channel) {
      channel.sendToQueue(
        'song_processing',
        Buffer.from(JSON.stringify({ songId: song.id, fileId })),
      );
    }

    // Optional cleanup
    // fs.unlinkSync(finalPath);

    return song;
  }

  /**
   * Builds the unsigned `upload_and_mint_song` Soroban transaction for the catalog
   * contract. The song must have a `metadataCid` and the artist must have a
   * connected Stellar wallet. The artist signs and submits via `submitSongMintTx`.
   *
   * @param songId - ID of the song to mint.
   * @param albumId - Optional album ID to associate (defaults to 0).
   * @returns PreparedTransaction containing the XDR and network passphrase.
   * @throws {Error} If song not found, no metadata CID, or no Stellar wallet.
   */
  async prepareSongMintTx(songId: string, albumId: number = 0): Promise<PreparedTransaction> {
    const song = await this.songRepo.findOne({ where: { id: songId }, relations: ['user'] });
    if (!song) throw new Error('Song not found');
    if (!song.metadataCid) throw new Error('Song has no metadata CID yet');

    const user = song.user ?? (await this.userRepo.findOneBy({ id: song.artistId }));
    if (!user?.stellarPublicKey) {
      throw new Error('Connect a Stellar wallet before minting this song');
    }

    const xdrTx = await this.soroban.prepareInvocation(
      user.stellarPublicKey,
      SorobanContracts.catalog,
      'upload_and_mint_song',
      [addressArg(user.stellarPublicKey), stringArg(song.metadataCid), u64Arg(albumId)],
    );

    return { xdr: xdrTx, networkPassphrase: process.env.SOROBAN_NETWORK_PASSPHRASE || '' };
  }

  /**
   * Submits the artist's signed `upload_and_mint_song` transaction to Soroban,
   * persists the on-chain song and token IDs, and updates the mint status.
   *
   * @param songId - ID of the song being minted.
   * @param signedXdr - The wallet-signed XDR transaction string.
   * @returns Transaction hash, on-chain song ID, and token ID.
   * @throws {Error} If song not found or Soroban submission fails (mintStatus set to "failed").
   */
  async submitSongMintTx(
    songId: string,
    signedXdr: string,
  ): Promise<{ txHash: string; songId: string; tokenId: string }> {
    const song = await this.songRepo.findOneBy({ id: songId });
    if (!song) throw new Error('Song not found');

    try {
      const { hash, returnValue } = await this.soroban.submitSignedTransaction(signedXdr);

      // upload_and_mint_song returns (song_id: u64, token_id: u64)
      const [onChainSongId, tokenId] = returnValue as [bigint, bigint];

      song.onChainSongId = onChainSongId.toString();
      song.onChainTokenId = tokenId.toString();
      song.mintStatus = 'minted';
      await this.songRepo.save(song);
      await CacheService.clearSong(songId);

      return { txHash: hash, songId: song.onChainSongId, tokenId: song.onChainTokenId };
    } catch (error) {
      song.mintStatus = 'failed';
      await this.songRepo.save(song);
      throw error;
    }
  }

  /**
   * Search songs by title / artist / keywords (Issue #135).
   *
   * Hits the precomputed inverted index first; on an index miss (no matching
   * tokens) falls back to a direct DB `ILIKE` query so results are never lost
   * just because the index hasn't caught up. Only `ready`, un-flagged songs
   * are returned.
   */
  async searchSongs(query: string, limit = 20): Promise<Song[]> {
    const trimmed = (query || '').trim();
    if (!trimmed) return [];

    const indexedIds = await SearchIndexService.search(trimmed, limit);

    if (indexedIds.length > 0) {
      const songs = await this.songRepo.find({
        where: { id: In(indexedIds), status: 'ready', flagged: false },
      });
      // Preserve the index's relevance ordering (DB `IN` doesn't guarantee it).
      const rank = new Map(indexedIds.map((id, i) => [id, i]));
      return songs.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    }

    // Index miss — fall back to the database.
    const like = `%${trimmed}%`;
    return this.songRepo
      .createQueryBuilder('song')
      .where('song.status = :status', { status: 'ready' })
      .andWhere('song.flagged = false')
      .andWhere(
        '(song.title ILIKE :like OR song.genre ILIKE :like OR song.composers ILIKE :like)',
        { like },
      )
      .orderBy('song.playCount', 'DESC')
      .take(limit)
      .getMany();
  }

  /**
   * Rebuild the entire search index from the current ready, unflagged catalog.
   *
   * @returns Number of songs indexed.
   */
  async rebuildSearchIndex(): Promise<number> {
    const songs = await this.songRepo.find({
      where: { status: 'ready', flagged: false },
      relations: ['user'],
    });
    return SearchIndexService.rebuild(songs);
  }

  /**
   * Flag a song as inappropriate, removing it from search results and creating
   * an audit log entry.
   *
   * @param songId - ID of the song to flag.
   * @param adminId - ID of the admin performing the action.
   * @param reason - Optional reason for flagging.
   * @returns Updated Song entity.
   * @throws {Error} If song not found or already flagged.
   */
  async flagSong(songId: string, adminId: string, reason?: string): Promise<Song> {
    const song = await this.songRepo.findOneBy({ id: songId });
    if (!song) throw new Error('Song not found');
    if (song.flagged) throw new Error('Song is already flagged');

    song.flagged = true;
    song.flaggedAt = new Date();
    song.flaggedBy = adminId;
    song.flagReason = reason || null;
    await this.songRepo.save(song);

    await this.logRepo.save({
      userId: adminId,
      action: 'song_flag',
      details: { songId, reason: reason || null },
    });

    // Flagged songs must not surface in search results (Issue #135).
    SearchIndexService.scheduleRemoval(songId);

    return song;
  }

  /**
   * Remove a flag from a song, restoring it to search results if its status
   * is "ready". Creates an audit log entry.
   *
   * @param songId - ID of the song to unflag.
   * @param adminId - ID of the admin performing the action.
   * @returns Updated Song entity.
   * @throws {Error} If song not found or not currently flagged.
   */
  async unflagSong(songId: string, adminId: string): Promise<Song> {
    const song = await this.songRepo.findOneBy({ id: songId });
    if (!song) throw new Error('Song not found');
    if (!song.flagged) throw new Error('Song is not flagged');

    song.flagged = false;
    song.flaggedAt = null;
    song.flaggedBy = null;
    song.flagReason = null;
    await this.songRepo.save(song);

    await this.logRepo.save({
      userId: adminId,
      action: 'song_unflag',
      details: { songId },
    });

    // Restore the song to the search index once it's unflagged (Issue #135).
    if (song.status === 'ready') {
      const full = await this.songRepo.findOne({
        where: { id: songId },
        relations: ['user'],
      });
      if (full) SearchIndexService.scheduleIndexUpdate(full);
    }

    return song;
  }
}
