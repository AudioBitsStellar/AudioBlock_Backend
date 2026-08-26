/**
 * Request input sanitization middleware (Issue #101)
 *
 * Defense-in-depth layer that strips potentially dangerous markup from every
 * string field in an incoming request body before it reaches controllers and
 * is persisted. While TypeORM parameterization already prevents SQL injection,
 * stored XSS in user-generated content (song titles, bios, usernames, etc.)
 * remains a risk — this middleware neutralizes it at the edge.
 *
 * Behaviour:
 *   - Removes dangerous elements (script/iframe/object/embed/style/link/…),
 *     including their inner content, then strips any remaining HTML tags.
 *   - Trims and collapses excessive whitespace and normalizes Unicode (NFKC),
 *     dropping zero-width / control characters commonly used to smuggle
 *     payloads past filters.
 *   - Enforces field-specific max lengths (name fields: 200, bio: 5000).
 *   - Recurses through nested objects and arrays.
 *   - Skips binary / multipart (file upload) requests so raw bytes are never
 *     touched.
 *   - Logs a single structured audit event per request when any field was
 *     actually modified.
 */
import { Request, Response, NextFunction, RequestHandler } from 'express';
import logger from '../config/logger';

/** Max length for name-like fields (name, username, title, …). */
export const NAME_FIELD_MAX_LENGTH = 200;

/** Max length for long-form free-text fields (bio, description, …). */
export const BIO_FIELD_MAX_LENGTH = 5000;

/** Field names (case-insensitive) treated as short "name" fields. */
const NAME_FIELDS = new Set(['name', 'username', 'title', 'displayname', 'fullname']);

/** Field names (case-insensitive) treated as long-form text fields. */
const BIO_FIELDS = new Set(['bio', 'description', 'about', 'summary']);

/** Guard against pathological deeply-nested payloads. */
const MAX_DEPTH = 10;

/**
 * Elements whose entire contents (not just the tags) must be removed, since
 * their bodies are executable/embeddable rather than displayable text.
 */
const DANGEROUS_ELEMENTS = [
  'script',
  'iframe',
  'object',
  'embed',
  'style',
  'link',
  'meta',
  'base',
  'form',
  'svg',
  'math',
];

const DANGEROUS_ELEMENT_REGEX = new RegExp(
  `<(${DANGEROUS_ELEMENTS.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1>`,
  'gi',
);

// Self-closing / unclosed variants of the dangerous elements above.
const DANGEROUS_SELF_CLOSING_REGEX = new RegExp(
  `<\\/?(${DANGEROUS_ELEMENTS.join('|')})\\b[^>]*>`,
  'gi',
);

// Any remaining HTML tag.
const HTML_TAG_REGEX = /<\/?[a-z][\s\S]*?>/gi;

// HTML comments (can hide conditional/IE payloads).
const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g;

// Zero-width / BOM / bidi-override code points used to smuggle payloads.
const INVISIBLE_CHARS_REGEX = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

// C0/C1 control characters, excluding tab, LF and CR.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Content types that carry raw/binary payloads we must never mutate. */
const SKIP_CONTENT_TYPES = [
  'multipart/form-data',
  'application/octet-stream',
  'application/pdf',
  'image/',
  'audio/',
  'video/',
];

/** Resolve the field-specific max length, if the key is a known field. */
function maxLengthForField(key: string): number | undefined {
  const normalizedKey = key.toLowerCase();
  if (NAME_FIELDS.has(normalizedKey)) {
    return NAME_FIELD_MAX_LENGTH;
  }
  if (BIO_FIELDS.has(normalizedKey)) {
    return BIO_FIELD_MAX_LENGTH;
  }
  return undefined;
}

/**
 * Sanitize a single string value:
 *   1. Normalize Unicode to NFKC (canonical + compatibility folding).
 *   2. Remove HTML comments and dangerous elements (with their content).
 *   3. Strip any remaining HTML tags.
 *   4. Drop invisible/zero-width and control characters.
 *   5. Collapse runs of whitespace and trim.
 *   6. Apply the field-specific max length.
 */
function sanitizeString(value: string, key: string): string {
  let result = value.normalize('NFKC');

  result = result.replace(HTML_COMMENT_REGEX, '');
  result = result.replace(DANGEROUS_ELEMENT_REGEX, '');
  result = result.replace(DANGEROUS_SELF_CLOSING_REGEX, '');
  result = result.replace(HTML_TAG_REGEX, '');

  result = result.replace(INVISIBLE_CHARS_REGEX, '');
  result = result.replace(CONTROL_CHARS_REGEX, '');

  // Collapse any run of whitespace (including newlines) to a single space.
  result = result.replace(/\s+/g, ' ').trim();

  const maxLength = maxLengthForField(key);
  if (maxLength !== undefined && result.length > maxLength) {
    result = result.slice(0, maxLength);
  }

  return result;
}

/** Tracks how many fields were mutated during a single request sanitization. */
interface SanitizeStats {
  fieldsModified: number;
}

/**
 * Recursively sanitize a value in place. Objects and arrays are walked;
 * strings are cleaned; all other primitives are returned untouched.
 */
function sanitizeValue(value: unknown, key: string, depth: number, stats: SanitizeStats): unknown {
  if (depth > MAX_DEPTH) {
    return value;
  }

  if (typeof value === 'string') {
    const cleaned = sanitizeString(value, key);
    if (cleaned !== value) {
      stats.fieldsModified += 1;
    }
    return cleaned;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = sanitizeValue(value[i], key, depth + 1, stats);
    }
    return value;
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const objectKey of Object.keys(record)) {
      record[objectKey] = sanitizeValue(record[objectKey], objectKey, depth + 1, stats);
    }
    return record;
  }

  return value;
}

/** True when the request body is a plain, sanitizable JSON-like object. */
function isSanitizableBody(body: unknown): boolean {
  return body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
}

/** True when the request carries a binary/multipart payload we must skip. */
function shouldSkipContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }
  const normalized = contentType.toLowerCase();
  return SKIP_CONTENT_TYPES.some((type) => normalized.includes(type));
}

/**
 * Express middleware that sanitizes `req.body` in place. No-ops for requests
 * without a body, for binary/multipart uploads, and for non-object bodies.
 */
export const sanitizeInput: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const contentType = req.headers['content-type'];

  if (shouldSkipContentType(contentType) || !isSanitizableBody(req.body)) {
    next();
    return;
  }

  const stats: SanitizeStats = { fieldsModified: 0 };
  req.body = sanitizeValue(req.body, '', 0, stats);

  if (stats.fieldsModified > 0) {
    logger.info(
      {
        reqId: (req as Request & { id?: string }).id,
        route: req.originalUrl,
        method: req.method,
        fieldsModified: stats.fieldsModified,
        event: 'input_sanitized',
      },
      'Request body sanitized',
    );
  }

  next();
};

export default sanitizeInput;
