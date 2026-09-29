import { TagSuggestionService } from '../TagSuggestionService';
import { AIProviderService, IAIAdapter } from '../AI/AIProviderService';

describe('TagSuggestionService (Issue #270)', () => {
  it('should return AI-suggested tags and genres from title and description', async () => {
    const mockAdapter: IAIAdapter = {
      name: 'mock-test-adapter',
      generateText: jest.fn().mockResolvedValue({
        text: JSON.stringify({
          genres: ['Synthwave', 'Electronic'],
          tags: ['retro', '80s', 'neon', 'synthesizer'],
        }),
      }),
      generateImage: jest.fn(),
      embed: jest.fn(),
    };

    const aiService = new AIProviderService(mockAdapter);
    const suggestionService = new TagSuggestionService(aiService);

    const result = await suggestionService.suggestTagsAndGenres({
      title: 'Midnight Highway Drive',
      description: 'A nostalgic synthwave track with retro 80s analog synthesizers',
      artistName: 'Neon Rider',
    });

    expect(result.genres).toEqual(['Synthwave', 'Electronic']);
    expect(result.tags).toEqual(['retro', '80s', 'neon', 'synthesizer']);
    expect(mockAdapter.generateText).toHaveBeenCalled();
  });

  it('should fall back silently with empty suggestions when AI provider throws an error', async () => {
    const failingAdapter: IAIAdapter = {
      name: 'failing-adapter',
      generateText: jest.fn().mockRejectedValue(new Error('AI provider API timeout or 503 error')),
      generateImage: jest.fn(),
      embed: jest.fn(),
    };

    const aiService = new AIProviderService(failingAdapter);
    const suggestionService = new TagSuggestionService(aiService);

    // Should NOT throw an error, must fall back silently
    const result = await suggestionService.suggestTagsAndGenres({
      title: 'Broken Stream',
      description: 'Will fail gracefully',
    });

    expect(result).toEqual({ tags: [], genres: [] });
  });

  it('should return empty arrays when title is blank or missing', async () => {
    const mockAdapter: IAIAdapter = {
      name: 'mock',
      generateText: jest.fn(),
      generateImage: jest.fn(),
      embed: jest.fn(),
    };
    const aiService = new AIProviderService(mockAdapter);
    const suggestionService = new TagSuggestionService(aiService);

    const result = await suggestionService.suggestTagsAndGenres({
      title: '',
      description: 'No title provided',
    });

    expect(result).toEqual({ tags: [], genres: [] });
    expect(mockAdapter.generateText).not.toHaveBeenCalled();
  });

  it('should handle non-JSON responses gracefully with fallback extraction', async () => {
    const textOnlyAdapter: IAIAdapter = {
      name: 'text-adapter',
      generateText: jest.fn().mockResolvedValue({
        text: 'Here are suggestions: ```json\n{"genres": ["Jazz", "Soul"], "tags": ["smooth", "horns"]}\n```',
      }),
      generateImage: jest.fn(),
      embed: jest.fn(),
    };

    const aiService = new AIProviderService(textOnlyAdapter);
    const suggestionService = new TagSuggestionService(aiService);

    const result = await suggestionService.suggestTagsAndGenres({
      title: 'Autumn Jazz',
      description: 'Warm saxophone and piano',
    });

    expect(result.genres).toEqual(['Jazz', 'Soul']);
    expect(result.tags).toEqual(['smooth', 'horns']);
  });
});
