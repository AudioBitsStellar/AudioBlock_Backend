import { Repository } from "typeorm";
import { Album } from "../entities/Album";
import AppDataSource from "../config/db";

export class AlbumService {

    private albumRepo: Repository<Album>;

    constructor() {
        this.albumRepo = AppDataSource.getRepository(Album);
    }

    // Add Songs to Ablum
    // So the idea is songs should already be uploaded and exist in the DB
    // This function will just link IDs of songs to Album entity
    // Like an array of song IDs in Album entity
    // async addSongsToAlbum(albumId: string, songIds: string[]): Promise<Album> {
    //     const album = await this.albumRepo.findOne({ where: { id: albumId } });
    //     if (!album) throw new Error("Album not found");

    //     // Assuming Album entity has a songs field which is an array of Song entities
    //     // Fetch existing songs and add to album
    //     const songRepo = AppDataSource.getRepository("Song");
    //     const songsToAdd = await songRepo.findByIds(songIds);

    //     if (!songsToAdd || songsToAdd.length === 0) {
    //         throw new Error("No valid songs found to add to album");
    //     }

    //     // Here we would normally push songs to album.songs array
    //     // But since we don't have that field defined in Album entity, this is just a placeholder
    //     album.songs.push(...songsToAdd);

    //     // Save updated album
    //     return await this.albumRepo.save(album);
    // }
}