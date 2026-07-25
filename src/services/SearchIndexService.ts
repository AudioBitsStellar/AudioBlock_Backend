/**
 * Precomputed song search index (Issue #135)
 * ───────────────────────────────────────────
 * Maintains a Redis-backed inverted index for fast song search. Instead of
 * scanning the songs table on every query, tokens (from title, artist name and
 * keywords) map to the set of song IDs that contain them, giving near-constant
 * lookup regardless of catalog size.
 *
 * Storage layout (Redis):
 *   search:token:<token>   → Set<songId>         (inverted index posting list)
 *   search:doc:<songId>    → JSON stored fields  (for cleanup on update/delete)
 *   search:docs            → Set<songId>         (all indexed docs, for rebuild)
 *
 * Because it lives in Redis it survives server restarts, and it's updated
 * asynchronously (off the request path) whenever a song is created, updated,
 * flagged or deleted.
 */
import redis from '../config/redis';
import logger from '../config/logger';

const TOKEN_PREFIX = 'search:token:';
const DOC_PREFIX = 'search:doc:';
const DOCS_SET = 'search:docs';

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
    }
    pipeline.del(DOCS_SET);
    await pipeline.exec();
  }
}
