/**
 * Precomputed song search index (Issue #135)
 * ───────────────────────────────────────────
 * Maintains a Redis-backed inverted index for fast song search. Instead of
 * scanning the songs table on every query, tokens (from title, artist name and
 * keywords) map to the set of song IDs that contain them, giving near-constant
 * lookup regardless of catalog size.
 *
 * Issue #274: Adds optional semantic search using AI embeddings alongside
 * keyword-based search. Falls back gracefully if embedding call fails.
 *
 * Storage layout (Redis):
 *   search:token:<token>   → Set<songId>         (inverted index posting list)
 *   search:doc:<songId>    → JSON stored fields  (for cleanup on update/delete)
 *   search:docs            → Set<songId>         (all indexed docs, for rebuild)
 *   search:embedding:<songId> → JSON float array (Issue #274: semantic vectors)
 *
 * Because it lives in Redis it survives server restarts, and it's updated
 * asynchronously (off the request path) whenever a song is created, updated,
 * flagged or deleted.
 */
import redis from '../config/redis';
import { getAiProvider } from './ai';
import logger from '../config/logger';

const TOKEN_PREFIX = 'search:token:';
const DOC_PREFIX = 'search:doc:';
const DOCS_SET = 'search:docs';
const EMBEDDING_PREFIX = 'search:embedding:'; // Issue #274

/** Fields we keep per indexed song. */
interface IndexedDoc {
  id: string;
  title: string;
  artist: string;
  keywords: string;
  tokens: string[];
}

/** Minimal shape needed to index a song (works for a full Song entity too). */
export interface IndexableSong {
  id: string;
  title?: string | null;
  genre?: string | null;
  composers?: string | null;
  artistAddress?: string | null;
  user?: { name?: string | null; username?: string | null } | null;
}

/**
 * Break text into normalized, de-duplicated tokens: lowercase, split on any
 * non-alphanumeric run, drop empties and single characters.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const raw = text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1);
  return Array.from(new Set(raw));
}

export class SearchIndexService {
  /** Derive the token set + stored fields for a song. */
  private static buildDoc(song: IndexableSong): IndexedDoc {
    const title = song.title ?? '';
    const artist = song.user?.name || song.user?.username || song.artistAddress || '';
    const keywords = [song.genre ?? '', song.composers ?? ''].filter(Boolean).join(' ');

    const tokens = tokenize(`${title} ${artist} ${keywords}`);
    return { id: song.id, title, artist, keywords, tokens };
  }

  /**
   * (Re)index a single song. Idempotent: any tokens from a previous version of
   * the doc are removed first so stale postings don't linger after edits.
   * Issue #274: Also generates and stores embeddings for semantic search.
   */
  static async indexSong(song: IndexableSong): Promise<void> {
    await this.removeSong(song.id); // clear previous postings first

    const doc = this.buildDoc(song);
    if (doc.tokens.length === 0) return;

    const pipeline = redis.pipeline();
    for (const token of doc.tokens) {
      pipeline.sadd(`${TOKEN_PREFIX}${token}`, doc.id);
    }
    pipeline.set(`${DOC_PREFIX}${doc.id}`, JSON.stringify(doc));
    pipeline.sadd(DOCS_SET, doc.id);
    await pipeline.exec();

    // Issue #274: Generate and store embedding (async, best-effort)
    await this.storeEmbedding(song, doc);

    logger.debug({ songId: doc.id, tokens: doc.tokens.length }, 'Search index updated');
  }

  /** Remove a song from the index (on delete, or when flagged/unpublished). */
  static async removeSong(songId: string): Promise<void> {
    const stored = await redis.get(`${DOC_PREFIX}${songId}`);
    if (!stored) return;

    let doc: IndexedDoc;
    try {
      doc = JSON.parse(stored);
    } catch {
      // Corrupt doc — best-effort cleanup of the doc key/set membership only.
      await redis.del(`${DOC_PREFIX}${songId}`);
      await redis.srem(DOCS_SET, songId);
      return;
    }

    const pipeline = redis.pipeline();
    for (const token of doc.tokens) {
      pipeline.srem(`${TOKEN_PREFIX}${token}`, songId);
    }
    pipeline.del(`${DOC_PREFIX}${songId}`);
    pipeline.srem(DOCS_SET, songId);
    await pipeline.exec();
  }

  /**
   * Search the index for song IDs matching the query, ranked by how many query
   * tokens each song matches (simple TF-style relevance). Returns an ordered
   * list of song IDs, best matches first. An empty array means "index miss" —
   * callers should fall back to a direct DB query.
   */
  static async search(query: string, limit = 20): Promise<string[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const token of tokens) {
      pipeline.smembers(`${TOKEN_PREFIX}${token}`);
    }
    const results = await pipeline.exec();
    if (!results) return [];

    // Score each song by the number of distinct query tokens it matched.
    const scores = new Map<string, number>();
    for (const [err, ids] of results as [Error | null, string[]][]) {
      if (err || !ids) continue;
      for (const id of ids) {
        scores.set(id, (scores.get(id) ?? 0) + 1);
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
  }

  /**
   * Schedule an asynchronous index update so callers never block on Redis. The
   * update runs on the next tick; failures are logged, not propagated (search
   * indexing must never fail a user-facing write).
   */
  static scheduleIndexUpdate(song: IndexableSong): void {
    setImmediate(() => {
      this.indexSong(song).catch((err) =>
        logger.warn({ err, songId: song.id }, 'Async search index update failed'),
      );
    });
  }

  /** Schedule an asynchronous removal from the index. */
  static scheduleRemoval(songId: string): void {
    setImmediate(() => {
      this.removeSong(songId).catch((err) =>
        logger.warn({ err, songId }, 'Async search index removal failed'),
      );
    });
  }

  /**
   * Rebuild the entire index from a fresh set of songs. Clears all existing
   * postings first, then indexes each song. Returns the number indexed.
   */
  static async rebuild(songs: IndexableSong[]): Promise<number> {
    logger.info({ count: songs.length }, 'Rebuilding search index');
    await this.clear();

    for (const song of songs) {
      await this.indexSong(song);
    }

    logger.info({ count: songs.length }, 'Search index rebuild complete');
    return songs.length;
  }

  /** Drop every key belonging to the search index. */
  static async clear(): Promise<void> {
    const docIds = await redis.smembers(DOCS_SET);
    const pipeline = redis.pipeline();

    for (const id of docIds) {
      const stored = await redis.get(`${DOC_PREFIX}${id}`);
      if (stored) {
        try {
          const doc: IndexedDoc = JSON.parse(stored);
          for (const token of doc.tokens) {
            pipeline.srem(`${TOKEN_PREFIX}${token}`, id);
          }
        } catch {
          /* ignore corrupt doc */
        }
      }
      pipeline.del(`${DOC_PREFIX}${id}`);
      pipeline.del(`${EMBEDDING_PREFIX}${id}`); // Issue #274
    }
    pipeline.del(DOCS_SET);
    await pipeline.exec();
  }

  /**
   * Issue #274: Generate and store embedding for a song (async, best-effort).
   * Called automatically during indexSong. Fails silently if AI call errors.
   */
  private static async storeEmbedding(song: IndexableSong, doc: IndexedDoc): Promise<void> {
    try {
      const provider = getAiProvider();
      const text = `${doc.title} ${doc.artist} ${doc.keywords}`.trim();

      const result = await provider.embed({ text });
      await redis.set(`${EMBEDDING_PREFIX}${song.id}`, JSON.stringify(result.embedding));

      logger.debug({ songId: song.id, model: result.model }, 'Song embedding stored');
    } catch (error) {
      // Fail silently: semantic search is optional enhancement
      logger.debug({ songId: song.id, error }, 'Failed to generate embedding, skipping');
    }
  }

  /**
   * Issue #274: Semantic search using embeddings. Falls back to keyword search
   * if embedding generation fails or no embeddings are available.
   */
  static async semanticSearch(query: string, limit = 20): Promise<string[]> {
    try {
      // Generate query embedding
      const provider = getAiProvider();
      const queryResult = await provider.embed({ text: query });
      const queryEmbedding = queryResult.embedding;

      // Fetch all doc IDs
      const allDocs = await redis.smembers(DOCS_SET);
      if (allDocs.length === 0) return [];

      // Calculate cosine similarity with each stored embedding
      const scores: Array<{ id: string; score: number }> = [];

      for (const docId of allDocs) {
        const embeddingData = await redis.get(`${EMBEDDING_PREFIX}${docId}`);
        if (!embeddingData) continue;

        try {
          const docEmbedding: number[] = JSON.parse(embeddingData);
          const similarity = this.cosineSimilarity(queryEmbedding, docEmbedding);
          scores.push({ id: docId, score: similarity });
        } catch {
          // Skip documents with corrupt embeddings
          continue;
        }
      }

      // Return top matches sorted by similarity
      return scores
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((s) => s.id);
    } catch (error) {
      // Fall back to keyword search if semantic search fails
      logger.debug({ error }, 'Semantic search failed, falling back to keyword search');
      return this.search(query, limit);
    }
  }

  /**
   * Issue #274: Calculate cosine similarity between two embedding vectors.
   */
  private static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}
