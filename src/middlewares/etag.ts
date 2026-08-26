/**
 * ETag + conditional-request caching middleware (Issue #133)
 * ──────────────────────────────────────────────────────────
 * Adds HTTP-level caching to read-heavy GET endpoints:
 *
 *   • Generates a strong ETag from a hash of the (JSON) response body.
 *   • Honors `If-None-Match` and returns `304 Not Modified` with an empty body
 *     when the client's ETag still matches — saving bandwidth on repeat reads.
 *   • Sets a configurable `Cache-Control` header: `max-age` for public data,
 *     `no-cache` for per-user data.
 *
 * The ETag is derived from the serialized response body, so it changes exactly
 * when the underlying data changes — i.e. it naturally tracks entity/list
 * versions without needing an explicit version column.
 *
 * Usage (per-route, opt-in):
 *   router.get("/popular", etagCache({ visibility: "public", maxAge: 60 }), handler);
 *   router.get("/me",      etagCache({ visibility: "private" }), handler);
 */
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { createHash } from 'crypto';

export interface EtagCacheOptions {
  /**
   * Cache visibility. `public` allows shared caches (CDN/proxy), `private`
   * restricts to the end client, `no-cache` forces revalidation every time
   * (still benefits from 304s). Default: `public`.
   */
  visibility?: 'public' | 'private' | 'no-cache';
  /** max-age in seconds for `public`/`private` responses. Default: 60. */
  maxAge?: number;
  /**
   * Explicit Cache-Control value. When set, overrides `visibility`/`maxAge`
   * entirely (e.g. "public, max-age=300, stale-while-revalidate=60").
   */
  cacheControl?: string;
}

/** Build the Cache-Control header value from the options. */
function buildCacheControl(opts: EtagCacheOptions): string {
  if (opts.cacheControl) return opts.cacheControl;

  const maxAge = opts.maxAge ?? 60;
  switch (opts.visibility) {
    case 'no-cache':
      return 'no-cache';
    case 'private':
      return `private, max-age=${maxAge}`;
    case 'public':
    default:
      return `public, max-age=${maxAge}`;
  }
}

/** Strong ETag: quoted SHA-1 of the payload. */
function generateEtag(payload: string): string {
  const hash = createHash('sha1').update(payload).digest('base64');
  return `"${hash}"`;
}

/**
 * Does the incoming If-None-Match header match the freshly-computed ETag?
 * Supports the `*` wildcard and comma-separated lists of tags, and tolerates
 * the weak-validator (`W/`) prefix.
 */
function ifNoneMatchSatisfied(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;

  const normalize = (tag: string) => tag.trim().replace(/^W\//, '');
  const target = normalize(etag);
  return header.split(',').some((tag) => normalize(tag) === target);
}

export function etagCache(options: EtagCacheOptions = {}): RequestHandler {
  const cacheControl = buildCacheControl(options);

  return (req: Request, res: Response, next: NextFunction) => {
    // Conditional caching only makes sense for safe, cacheable reads.
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const originalJson = res.json.bind(res);

    res.json = ((body: any): Response => {
      try {
        // Only attach validators to successful responses; don't cache errors.
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const payload = JSON.stringify(body ?? null);
          const etag = generateEtag(payload);

          res.setHeader('ETag', etag);
          res.setHeader('Cache-Control', cacheControl);

          if (ifNoneMatchSatisfied(req.headers['if-none-match'], etag)) {
            // 304 responses MUST NOT carry a body (bandwidth savings).
            res.status(304);
            res.removeHeader('Content-Type');
            res.removeHeader('Content-Length');
            return res.end() as unknown as Response;
          }
        }
      } catch {
        // If anything goes wrong computing the ETag, fall back to sending the
        // body uncached rather than failing the request.
      }

      return originalJson(body);
    }) as Response['json'];

    next();
  };
}
