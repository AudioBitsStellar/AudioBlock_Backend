/**
 * Unit tests for the ETag conditional-caching middleware (Issue #133).
 */
import { etagCache } from '../middlewares/etag';

function mockReq(overrides: Partial<any> = {}): any {
  return { method: 'GET', headers: {}, ...overrides };
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, any>,
    body: undefined,
    ended: false,
    setHeader(k: string, v: any) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return this.headers[k.toLowerCase()];
    },
    removeHeader(k: string) {
      delete this.headers[k.toLowerCase()];
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
    json(b: any) {
      this.body = b;
      return this;
    },
  };
  return res;
}

describe('etagCache middleware', () => {
  it('sets a strong ETag and Cache-Control on a 200 JSON response', () => {
    const req = mockReq();
    const res = mockRes();
    etagCache({ visibility: 'public', maxAge: 60 })(req, res, () => {});

    res.json({ hello: 'world' });

    expect(res.getHeader('ETag')).toMatch(/^".+"$/);
    expect(res.getHeader('Cache-Control')).toBe('public, max-age=60');
    expect(res.body).toEqual({ hello: 'world' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 304 with no body when If-None-Match matches', () => {
    // First request to learn the ETag for this payload.
    const first = mockRes();
    etagCache()(mockReq(), first, () => {});
    first.json({ a: 1, b: 2 });
    const etag = first.getHeader('ETag');

    // Second request presents that ETag.
    const req = mockReq({ headers: { 'if-none-match': etag } });
    const res = mockRes();
    etagCache()(req, res, () => {});
    res.json({ a: 1, b: 2 });

    expect(res.statusCode).toBe(304);
    expect(res.ended).toBe(true);
    expect(res.body).toBeUndefined();
  });

  it('does not 304 when the body (and thus ETag) changed', () => {
    const req = mockReq({ headers: { 'if-none-match': '"stale-etag"' } });
    const res = mockRes();
    etagCache()(req, res, () => {});
    res.json({ a: 1 });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ a: 1 });
  });

  it('emits no-cache for user-scoped data', () => {
    const res = mockRes();
    etagCache({ visibility: 'no-cache' })(mockReq(), res, () => {});
    res.json({ secret: true });

    expect(res.getHeader('Cache-Control')).toBe('no-cache');
  });

  it('ignores non-GET requests', () => {
    const req = mockReq({ method: 'POST' });
    const res = mockRes();
    etagCache()(req, res, () => {});
    res.json({ ok: true });

    expect(res.getHeader('ETag')).toBeUndefined();
  });
});
