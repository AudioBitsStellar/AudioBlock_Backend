/**
 * Provider-neutral AI domain interface (ADR-007: docs/adrs/007-ai-integration.md).
 *
 * Business logic depends only on this interface, never on a vendor SDK
 * directly — swapping providers means implementing this interface, not
 * touching call sites. See `NoopAiProvider` for the always-available
 * no-vendor default.
 */

export interface CoverArtGenerationInput {
  songId: string;
  title: string;
  genre?: string;
  mood?: string;
}

export interface CoverArtGenerationResult {
  /** URI of the generated artwork. Provider-specific; may be a placeholder. */
  imageUrl: string;
  provider: string;
}

export interface DescriptionGenerationInput {
  songId: string;
  title: string;
  artistName?: string;
  genre?: string;
}

export interface DescriptionGenerationResult {
  description: string;
  provider: string;
}

export interface TweetDraftInput {
  songId?: string;
  title: string;
  artistName: string;
  releaseUrl?: string;
}

export interface TweetDraftResult {
  text: string;
  provider: string;
}

/** Issue #273: Content moderation scoring input */
export interface ContentModerationInput {
  reportId: string;
  contentType: 'song' | 'comment' | 'profile';
  contentText?: string;
  reportReason: string;
  reporterContext?: string;
}

/** Issue #273: Content moderation scoring result (advisory only) */
export interface ContentModerationResult {
  severityScore: number; // 0-100, higher = more urgent
  suggestedPriority: 'low' | 'medium' | 'high' | 'critical';
  categories: string[]; // e.g., ['harassment', 'spam']
  reasoning?: string;
  provider: string;
}

/** Issue #274: Embedding input for semantic search */
export interface EmbeddingInput {
  text: string;
  model?: string;
}

/** Issue #274: Embedding result */
export interface EmbeddingResult {
  embedding: number[]; // Vector of floats
  model: string;
  provider: string;
}

export interface AiProvider {
  /** Identifies the concrete provider in logs and stored generation records. */
  readonly name: string;

  generateCoverArt(input: CoverArtGenerationInput): Promise<CoverArtGenerationResult>;

  generateDescription(input: DescriptionGenerationInput): Promise<DescriptionGenerationResult>;

  draftTweet(input: TweetDraftInput): Promise<TweetDraftResult>;

  /** Issue #273: Score/pre-categorize content moderation reports (advisory only) */
  scoreContentReport(input: ContentModerationInput): Promise<ContentModerationResult>;

  /** Issue #274: Generate embeddings for semantic search */
  embed(input: EmbeddingInput): Promise<EmbeddingResult>;
}
