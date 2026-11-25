import express from 'express';
import request from 'supertest';
import { resolveTrustProxy } from '../../src/config/proxy';
import helmet from 'helmet';

describe('HTTP security configuration', () => {
  it('sets standard security headers and allows embed routes to be framed', async () => {
    const app = express();
    app.disable('x-powered-by');
    app.use(helmet({ hsts: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
    app.get('/api/test', (_req, res) => res.json({ ok: true }));
    app.use('/api/embed/test', (_req, res, next) => {
      res.removeHeader('X-Frame-Options');
      next();
    }, (_req, res) => res.send('<iframe></iframe>'));

    const api = await request(app).get('/api/test');
    expect(api.headers['x-content-type-options']).toBe('nosniff');
    expect(api.headers['x-powered-by']).toBeUndefined();
    expect(api.headers['cross-origin-resource-policy']).toBe('cross-origin');

    const embed = await request(app).get('/api/embed/test');
    expect(embed.headers['x-frame-options']).toBeUndefined();
  });
  it('trusts exactly one managed proxy by default in production', () => {
    expect(resolveTrustProxy('production', undefined)).toBe(1);
    expect(resolveTrustProxy('development', undefined)).toBe(false);
  });

  it('allows deployments to declare their proxy hop count', () => {
    expect(resolveTrustProxy('production', '2')).toBe(2);
    expect(resolveTrustProxy('production', '-1')).toBe(0);
  });

  it('returns a 413 for an oversized JSON document', async () => {
    const app = express();
    app.use(express.json({ limit: '100b' }));
    app.post('/payload', (_req, res) => res.sendStatus(204));
    app.use(
      (
        err: { status?: number },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        if (err.status === 413) return res.status(413).json({ type: 'PAYLOAD_TOO_LARGE' });
        return res.sendStatus(500);
      },
    );

    const response = await request(app)
      .post('/payload')
      .set('Content-Type', 'application/json')
      .send({ payload: 'x'.repeat(500) });
    expect(response.status).toBe(413);
    expect(response.body.type).toBe('PAYLOAD_TOO_LARGE');
  });
});
