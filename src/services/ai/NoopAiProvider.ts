import {
  AiProvider,
  CoverArtGenerationInput,
  CoverArtGenerationResult,
  DescriptionGenerationInput,
  DescriptionGenerationResult,
  TweetDraftInput,
  TweetDraftResult,
} from './AiProvider';

/**
 * The always-available default provider (ADR-007, point 1): "a null/no-op
 * provider is always available so the platform runs fully without any AI
 * dependency." No network call is made and no user content leaves the
 * process — outputs are deterministic, rule-based templates, in the same
 * spirit as the other "AI-adjacent" features listed in docs/AI_FEATURES.md.
 *
 * This is what runs until a real vendor is wired up behind `AiProvider`.
 */
export class NoopAiProvider implements AiProvider {
  readonly name = 'noop';

  async generateCoverArt(input: CoverArtGenerationInput): Promise<CoverArtGenerationResult> {
    return {
      imageUrl: `ai://noop/cover-art/${input.songId}`,
      provider: this.name,
    };
  }

  async generateDescription(
    input: DescriptionGenerationInput,
  ): Promise<DescriptionGenerationResult> {
    const artist = input.artistName ? ` by ${input.artistName}` : '';
    const genre = input.genre ? ` in the ${input.genre} genre` : '';
    return {
      description: `"${input.title}"${artist} is a track${genre} on AudioBlock.`,
      provider: this.name,
    };
  }

  async draftTweet(input: TweetDraftInput): Promise<TweetDraftResult> {
    const url = input.releaseUrl ? ` ${input.releaseUrl}` : '';
    return {
      text: `${input.artistName} just released "${input.title}"! Listen now.${url}`,
      provider: this.name,
    };
  }
}
