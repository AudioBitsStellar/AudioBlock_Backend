import AppDataSource from '../config/db';
import { Genre } from '../entities/Genre';
import { CacheService } from './CacheService';

export interface GenreWithSongCount {
  id: string;
  name: string;
  songCount: number;
}

export class GenreService {
  private genreRepo = AppDataSource.getRepository(Genre);

  async getAllGenres(): Promise<Genre[]> {
    const cached = await CacheService.getGenreList<Genre[]>();
    if (cached) return cached;

    const genres = await this.genreRepo.find({ order: { name: 'ASC' } });
    await CacheService.cacheGenreList(genres);
    return genres;
  }

  async getGenreById(id: string): Promise<Genre | null> {
    return this.genreRepo.findOneBy({ id });
  }

  /**
   * Every genre with the number of songs linked to it (Issue #78).
   *
   * Counts are computed live from the songs join rather than cached, so the
   * list always reflects newly published songs without cache invalidation.
   */
  async getGenresWithSongCounts(): Promise<GenreWithSongCount[]> {
    const rows = await this.genreRepo
      .createQueryBuilder('genre')
      .leftJoin('genre.songs', 'song')
      .select('genre.id', 'id')
      .addSelect('genre.name', 'name')
      .addSelect('COUNT(song.id)', 'songCount')
      .groupBy('genre.id')
      .addGroupBy('genre.name')
      .orderBy('genre.name', 'ASC')
      .getRawMany();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      songCount: Number(row.songCount) || 0,
    }));
  }

  async createGenre(name: string): Promise<Genre> {
    const genre = this.genreRepo.create({ name });
    await this.genreRepo.save(genre);
    await CacheService.invalidateGenreList();
    return genre;
  }

  async removeGenre(id: string): Promise<void> {
    await this.genreRepo.delete(id);
    await CacheService.invalidateGenreList();
  }
}
