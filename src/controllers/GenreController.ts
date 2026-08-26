import { Request, Response } from 'express';
import { GenreService } from '../services/GenreService';
import { SongService } from '../services/SongService';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

const genreService = new GenreService();
const songService = new SongService();

export class GenreController {
  /** GET /api/genres — all genres with song counts (Issue #78). */
  static listGenres = async (_req: Request, res: Response) => {
    try {
      const genres = await genreService.getGenresWithSongCounts();
      return res.status(200).json({ success: true, data: genres });
    } catch (error) {
      handleError(res, error);
    }
  };

  /** GET /api/genres/:id/songs — songs in a genre with pagination + sorting. */
  static getGenreSongs = async (req: Request, res: Response) => {
    try {
      const genreId = req.params.id as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const sort = (req.query.sort as 'newest' | 'most_played' | 'alphabetical') || 'newest';

      const genre = await genreService.getGenreById(genreId);
      if (!genre) {
        throw AppError.notFound('Genre not found', undefined, 'GENRE_NOT_FOUND');
      }

      const result = await songService.getSongsByGenre(genreId, page, limit, sort);

      return res.status(200).json({
        success: true,
        genre: { id: genre.id, name: genre.name },
        ...result,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
