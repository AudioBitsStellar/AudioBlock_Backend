import { runAuthSpikeLoadTest } from '../../scripts/load-test-auth-spikes';
import http from 'http';

describe('Issue #641: Load Test Auth Endpoints for Concurrent Login Spikes', () => {
  let mockServer: http.Server;
  const mockPort = 3099;
  let requestCounter = 0;

  beforeAll((done) => {
    // Create mock HTTP server simulating auth endpoint with concurrency and rate limiting
    mockServer = http.createServer((req, res) => {
      requestCounter++;
      // Simulate rate limiter triggering after 30 concurrent requests
      if (requestCounter > 30) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Too many login attempts, please try again later.' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, token: 'mock-jwt-token' }));
      }
    });

    mockServer.listen(mockPort, done);
  });

  afterAll((done) => {
    mockServer.close(done);
  });

  beforeEach(() => {
    requestCounter = 0;
  });

  it('should handle concurrent login spikes and throttle excess requests with 429 without dropping connections', async () => {
    const results = await runAuthSpikeLoadTest({
      baseUrl: `http://localhost:${mockPort}`,
      concurrency: 20,
      totalRequests: 50,
      endpoint: '/login',
    });

    expect(results.total).toBe(50);
    expect(results.successful).toBe(30);
    expect(results.rateLimited).toBe(20);
    expect(results.failed).toBe(0);
    expect(results.p50).toBeLessThan(500);
    expect(results.rps).toBeGreaterThan(0);
  });
});
