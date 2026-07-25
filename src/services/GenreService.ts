import AppDataSource from '../config/db';
import { Genre } from '../entities/Genre';
import { CacheService } from './CacheService';

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
