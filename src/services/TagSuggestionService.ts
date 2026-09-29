import logger from '../config/logger';
import { AIProviderService, getAIProviderService } from './AI/AIProviderService';

export interface TagGenreSuggestionInput {
  title: string;
  description?: string;
  artistName?: string;
}

export interface TagGenreSuggestions {
  tags: string[];
  genres: string[];
}

/**
 * Service for generating AI-suggested tags and genres for songs (Issue #270).
 *
 * Guarantees:
 * - Suggestions are strictly opt-in and advisory; never automatically applied to song entities.
 * - Fails open / falls back silently to empty suggestions if AI call fails or is unavailable.
 * - Interacts exclusively with AIProviderService abstraction.
 */
export class TagSuggestionService {
  private aiService: AIProviderService;

  constructor(aiService?: AIProviderService) {
    this.aiService = aiService || getAIProviderService();
  }

  /**
   * Suggest relevant tags and genres for a song based on title and description.
   */
  async suggestTagsAndGenres(input: TagGenreSuggestionInput): Promise<TagGenreSuggestions> {
    if (!input.title || !input.title.trim()) {
      return { tags: [], genres: [] };
    }

    try {
      const prompt = `Analyze the song titled "${input.title}" with description "${input.description || ''}" by artist "${input.artistName || 'Unknown'}". Suggest suitable musical genres and mood/style tags. Respond in JSON format: {"genres": string[], "tags": string[]}.`;

      const response = await this.aiService.generateText({
        prompt,
        temperature: 0.3,
        maxTokens: 150,
      });

      let parsed: any;
      try {
        parsed = JSON.parse(response.text);
      } catch {
        const jsonMatch = response.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      }

      if (parsed && (Array.isArray(parsed.tags) || Array.isArray(parsed.genres))) {
        const tags = Array.isArray(parsed.tags)
          ? parsed.tags.map((t: string) => String(t).trim().toLowerCase()).filter(Boolean)
          : [];
        const genres = Array.isArray(parsed.genres)
          ? parsed.genres.map((g: string) => String(g).trim()).filter(Boolean)
          : [];

        return {
          tags: [...new Set(tags)],
          genres: [...new Set(genres)],
        };
      }

      return { tags: [], genres: [] };
    } catch (error) {
      // Per acceptance criteria: falls back silently if AI call fails
      logger.warn(
        { err: error },
        'AI tag/genre suggestion encountered an error; falling back silently',
      );
      return { tags: [], genres: [] };
    }
  }
}
