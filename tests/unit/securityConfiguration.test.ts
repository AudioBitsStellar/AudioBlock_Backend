import express from 'express';
import request from 'supertest';
import { resolveTrustProxy } from '../../src/config/proxy';

describe('HTTP security configuration', () => {
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
