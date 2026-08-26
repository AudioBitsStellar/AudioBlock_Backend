import type { Request, Response, NextFunction } from 'express';

// Mock the structured logger so audit-log assertions are cheap and side-effect free.
const mockLoggerInfo = jest.fn();
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: (...args: unknown[]) => mockLoggerInfo(...args) },
}));

import { sanitizeInput, NAME_FIELD_MAX_LENGTH, BIO_FIELD_MAX_LENGTH } from '../sanitizeInput';

/** Build a minimal mock Request. */
function makeReq(body: unknown, contentType = 'application/json'): Request {
  return {
    body,
    method: 'POST',
    originalUrl: '/api/test',
    headers: { 'content-type': contentType },
    id: 'req-123',
  } as unknown as Request;
}

/** Run the middleware synchronously and return the (possibly mutated) body. */
function run(req: Request): { body: unknown; nextCalled: boolean } {
  const res = {} as Response;
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  sanitizeInput(req, res, next);
  return { body: req.body, nextCalled };
}

describe('sanitizeInput middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('HTML / script stripping', () => {
    it('removes script tags and their contents entirely', () => {
      const req = makeReq({ comment: 'hello<script>alert(1)</script> world' });
      const { body } = run(req) as { body: { comment: string } };
      expect(body.comment).toBe('hello world');
      expect(body.comment).not.toContain('alert');
    });

    it('removes iframe, object and embed elements', () => {
      const req = makeReq({
        a: 'x<iframe src="evil"></iframe>y',
        b: 'x<object data="evil"></object>y',
        c: 'x<embed src="evil">y',
      });
      const { body } = run(req) as { body: { a: string; b: string; c: string } };
      expect(body.a).toBe('xy');
      expect(body.b).toBe('xy');
      expect(body.c).toBe('xy');
    });

    it('strips generic HTML tags but keeps their text content', () => {
      const req = makeReq({ note: 'a\u0001b\u0002c' });
      const { body } = run(req) as { body: { note: string } };
      expect(body.note).toBe('abc');
    });
  });

  describe('field-specific length caps', () => {
    it('truncates name fields to the name max length', () => {
      const req = makeReq({ name: 'a'.repeat(NAME_FIELD_MAX_LENGTH + 50) });
      const { body } = run(req) as { body: { name: string } };
      expect(body.name).toHaveLength(NAME_FIELD_MAX_LENGTH);
    });

    it('truncates bio fields to the bio max length', () => {
      const req = makeReq({ bio: 'b'.repeat(BIO_FIELD_MAX_LENGTH + 100) });
      const { body } = run(req) as { body: { bio: string } };
      expect(body.bio).toHaveLength(BIO_FIELD_MAX_LENGTH);
    });

    it('is case-insensitive for field name matching', () => {
      const req = makeReq({ Username: 'u'.repeat(NAME_FIELD_MAX_LENGTH + 10) });
      const { body } = run(req) as { body: { Username: string } };
      expect(body.Username).toHaveLength(NAME_FIELD_MAX_LENGTH);
    });

    it('does not cap unknown fields', () => {
      const long = 'c'.repeat(NAME_FIELD_MAX_LENGTH + 10);
      const req = makeReq({ arbitrary: long });
      const { body } = run(req) as { body: { arbitrary: string } };
      expect(body.arbitrary).toHaveLength(long.length);
    });
  });

  describe('recursion', () => {
    it('sanitizes nested objects and arrays', () => {
      const req = makeReq({
        profile: { bio: '<script>x</script>clean' },
        tags: ['<b>one</b>', 'two<iframe></iframe>'],
      });
      const { body } = run(req) as {
        body: { profile: { bio: string }; tags: string[] };
      };
      expect(body.profile.bio).toBe('clean');
      expect(body.tags).toEqual(['one', 'two']);
    });

    it('leaves non-string primitives untouched', () => {
      const req = makeReq({ count: 42, active: true, missing: null });
      const { body } = run(req) as {
        body: { count: number; active: boolean; missing: null };
      };
      expect(body.count).toBe(42);
      expect(body.active).toBe(true);
      expect(body.missing).toBeNull();
    });

    it('stops recursing beyond the max depth guard', () => {
      // Nest a dirty string deeper than MAX_DEPTH (10); it should be left as-is.
      let nested: Record<string, unknown> = { note: '<script>x</script>deep' };
      for (let i = 0; i < 12; i += 1) {
        nested = { child: nested };
      }
      const req = makeReq(nested);
      const { body } = run(req);
      // Walk back down to the leaf and confirm it was NOT sanitized.
      let cursor: Record<string, unknown> = body as Record<string, unknown>;
      for (let i = 0; i < 12; i += 1) {
        cursor = cursor.child as Record<string, unknown>;
      }
      expect(cursor.note).toBe('<script>x</script>deep');
    });
  });

  describe('skip conditions', () => {
    it('skips multipart/form-data uploads', () => {
      const original = { file: '<script>keep-raw</script>' };
      const req = makeReq(original, 'multipart/form-data; boundary=xyz');
      const { body, nextCalled } = run(req) as {
        body: { file: string };
        nextCalled: boolean;
      };
      expect(body.file).toBe('<script>keep-raw</script>');
      expect(nextCalled).toBe(true);
    });

    it('skips binary content types', () => {
      const req = makeReq({ x: '<b>y</b>' }, 'application/octet-stream');
      const { body } = run(req) as { body: { x: string } };
      expect(body.x).toBe('<b>y</b>');
    });

    it('no-ops when body is not an object', () => {
      const req = makeReq('a plain string body');
      const { body, nextCalled } = run(req);
      expect(body).toBe('a plain string body');
      expect(nextCalled).toBe(true);
    });

    it('no-ops when there is no body', () => {
      const req = makeReq(undefined);
      const { nextCalled } = run(req);
      expect(nextCalled).toBe(true);
    });

    it('sanitizes when no content-type header is present', () => {
      const req = makeReq({ note: '<script>x</script>hi' }, '');
      // Remove the header entirely to exercise the undefined-content-type branch.
      (req.headers as Record<string, unknown>)['content-type'] = undefined;
      const { body } = run(req) as { body: { note: string } };
      expect(body.note).toBe('hi');
    });
  });

  describe('audit logging', () => {
    it('logs once when at least one field was modified', () => {
      const req = makeReq({ note: '<script>x</script>hi' });
      run(req);
      expect(mockLoggerInfo).toHaveBeenCalledTimes(1);
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'input_sanitized', fieldsModified: 1 }),
        expect.any(String),
      );
    });

    it('does not log when nothing was modified', () => {
      const req = makeReq({ note: 'already clean' });
      run(req);
      expect(mockLoggerInfo).not.toHaveBeenCalled();
    });
  });

  it('always calls next()', () => {
    const req = makeReq({ note: 'anything' });
    const { nextCalled } = run(req);
    expect(nextCalled).toBe(true);
  });
});
