import {
  DEFAULT_HEALTH_PORTS,
  RoleHealthServer,
  resolveHealthPort,
  startRoleHealthServer,
} from '../roleHealthServer';

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const started: RoleHealthServer[] = [];

async function start(
  overrides: Partial<Parameters<typeof startRoleHealthServer>[0]> = {},
): Promise<RoleHealthServer> {
  const server = await startRoleHealthServer({
    role: 'worker',
    port: 0,
    host: '127.0.0.1',
    isReady: () => true,
    ...overrides,
  });
  started.push(server);
  return server;
}

function url(server: RoleHealthServer, path: string): string {
  return `http://127.0.0.1:${server.port}${path}`;
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((s) => s.close().catch(() => undefined)));
});

describe('resolveHealthPort', () => {
  const original = process.env.HEALTH_PORT;

  afterEach(() => {
    if (original === undefined) delete process.env.HEALTH_PORT;
    else process.env.HEALTH_PORT = original;
  });

  it('falls back to the per-role default when HEALTH_PORT is unset', () => {
    delete process.env.HEALTH_PORT;
    expect(resolveHealthPort('worker')).toBe(DEFAULT_HEALTH_PORTS.worker);
    expect(resolveHealthPort('indexer')).toBe(DEFAULT_HEALTH_PORTS.indexer);
    expect(resolveHealthPort('scheduler')).toBe(DEFAULT_HEALTH_PORTS.scheduler);
  });

  it('keeps the four roles on distinct defaults', () => {
    const ports = Object.values(DEFAULT_HEALTH_PORTS);
    expect(new Set(ports).size).toBe(ports.length);
  });

  it('honours a valid HEALTH_PORT override', () => {
    process.env.HEALTH_PORT = '19555';
    expect(resolveHealthPort('indexer')).toBe(19555);
  });

  it.each(['0', '-1', 'not-a-port', ''])('ignores the invalid override %p', (value) => {
    process.env.HEALTH_PORT = value;
    expect(resolveHealthPort('scheduler')).toBe(DEFAULT_HEALTH_PORTS.scheduler);
  });
});

describe('role health server', () => {
  it('answers liveness with the role identity', async () => {
    const server = await start({ role: 'indexer' });
    const res = await fetch(url(server, '/health/live'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', role: 'indexer', pid: process.pid });
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('answers / and /health as liveness aliases', async () => {
    const server = await start({ role: 'scheduler' });
    for (const path of ['/', '/health']) {
      const res = await fetch(url(server, path));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ role: 'scheduler' });
    }
  });

  it('answers HEAD probes', async () => {
    const server = await start();
    const res = await fetch(url(server, '/health/live'), { method: 'HEAD' });
    expect(res.status).toBe(200);
  });

  it('reports 503 until the role says it is ready', async () => {
    let ready = false;
    const server = await start({ isReady: () => ready });

    const notReady = await fetch(url(server, '/health/ready'));
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toMatchObject({ ready: false, status: 'unavailable' });

    ready = true;
    const nowReady = await fetch(url(server, '/health/ready'));
    expect(nowReady.status).toBe(200);
    expect(await nowReady.json()).toMatchObject({ ready: true, status: 'ok' });
  });

  it('treats a throwing readiness check as not ready, not as a crash', async () => {
    const server = await start({
      isReady: () => {
        throw new Error('db unavailable');
      },
    });

    const res = await fetch(url(server, '/health/ready'));
    expect(res.status).toBe(503);

    const live = await fetch(url(server, '/health/live'));
    expect(live.status).toBe(200);
  });

  it('ignores query strings and trailing slashes', async () => {
    const server = await start();
    const res = await fetch(url(server, '/health/live/?probe=1'));
    expect(res.status).toBe(200);
  });

  it('404s unknown paths and 405s non-read methods', async () => {
    const server = await start();

    const missing = await fetch(url(server, '/nope'));
    expect(missing.status).toBe(404);

    const post = await fetch(url(server, '/health/live'), { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('resolves the real bound port when asked for an ephemeral one', async () => {
    const server = await start();
    expect(server.port).toBeGreaterThan(0);
  });

  it('rejects startup when the port is already taken', async () => {
    const first = await start();
    await expect(
      startRoleHealthServer({
        role: 'indexer',
        port: first.port,
        host: '127.0.0.1',
        isReady: () => true,
      }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('stops answering after close()', async () => {
    const server = await start();
    await server.close();
    await expect(fetch(url(server, '/health/live'))).rejects.toThrow();
  });
});
