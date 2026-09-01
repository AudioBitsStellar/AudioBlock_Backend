import { SorobanEventReader, EventReaderServer } from '../services/Soroban/SorobanEventReader';

// @stellar/stellar-sdk's CJS build pulls in an ESM-only @noble/hashes, which
// ts-jest cannot transform. Mock the SDK so we only exercise our reader logic.
jest.mock('@stellar/stellar-sdk', () => ({
  scValToNative: jest.fn((value: unknown) => value),
  Networks: { TESTNET: 'Test', PUBLIC: 'Public' },
}));

function mockServer(overrides: {
  events?: unknown[][];
  latest?: number;
}): EventReaderServer & { getEventsCalls: unknown[] } {
  const calls: unknown[] = [];
  return {
    getEventsCalls: calls,
    async getEvents(request: unknown) {
      calls.push(request);
      const batch: unknown[] = [];
      if (overrides.events) {
        for (const e of overrides.events) {
          batch.push({
            id: String(e[0]),
            ledger: e[1],
            txHash: 'tx',
            topic: [{ symbol: 'event' }],
            value: 'val',
            contractId: 'CA_CONTRACT',
          });
        }
      }
      return {
        events: batch,
        cursor: 'next-cursor-123',
        latestLedger: overrides.latest ?? 500,
      };
    },
    async getLatestLedger() {
      return { sequence: overrides.latest ?? 500 };
    },
  };
}

describe('SorobanEventReader', () => {
  it('returns the latest ledger', async () => {
    const server = mockServer({ latest: 999 });
    const reader = new SorobanEventReader(server);
    await expect(reader.getLatestLedger()).resolves.toBe(999);
  });

  it('fetches and normalizes events preserving contract id', async () => {
    const server = mockServer({
      events: [
        [1, 100],
        [2, 101],
      ],
      latest: 500,
    });
    const reader = new SorobanEventReader(server);

    const page = await reader.fetchEvents({ contractIds: ['CA_CONTRACT'] });

    expect(page.events).toHaveLength(2);
    expect(page.events[0]).toMatchObject({ id: '1', ledger: 100, contractId: 'CA_CONTRACT' });
    expect(page.cursor).toBe('next-cursor-123');
    expect(page.latestLedger).toBe(500);
  });

  it('passes range params in range mode and cursor in cursor mode', async () => {
    const server = mockServer({ events: [] });
    const reader = new SorobanEventReader(server);

    await reader.fetchEvents({ contractIds: ['CA'], startLedger: 10, endLedger: 20 });
    expect(server.getEventsCalls[0]).toMatchObject({ startLedger: 10, endLedger: 20 });
    expect((server.getEventsCalls[0] as any).cursor).toBeUndefined();

    await reader.fetchEvents({ contractIds: ['CA'], cursor: 'abc' });
    expect(server.getEventsCalls[1]).toMatchObject({ cursor: 'abc' });
    expect((server.getEventsCalls[1] as any).startLedger).toBeUndefined();
  });

  it('skips malformed events without throwing', async () => {
    const reader = new SorobanEventReader({
      async getEvents() {
        return {
          events: [
            { id: '1', ledger: 100, topic: 'not-an-array', value: null },
            null,
            { id: '2', ledger: 101, topic: [] },
          ],
          cursor: 'c',
          latestLedger: 500,
        };
      },
      async getLatestLedger() {
        return { sequence: 500 };
      },
    });

    const page = await reader.fetchEvents({ contractIds: ['CA'] });
    // The null entry is skipped; the two non-null events (even with an
    // unreadable topic) are returned with their contract id filled in.
    expect(page.events).toHaveLength(2);
    expect(page.events[0]).toMatchObject({ id: '1', ledger: 100, contractId: 'CA', topic: [] });
  });

  it('fetchAllInRange walks the range and stops when exhausted', async () => {
    let callCount = 0;
    const reader = new SorobanEventReader({
      async getEvents(request: { startLedger: number }) {
        callCount += 1;
        const from = request.startLedger;
        if (from > 205) {
          return { events: [], cursor: '', latestLedger: 500 };
        }
        return {
          events: [
            {
              id: `evt-${from}`,
              ledger: from,
              txHash: 'tx',
              topic: [],
              value: null,
            },
          ],
          cursor: `cursor-${from}`,
          latestLedger: 500,
        };
      },
      async getLatestLedger() {
        return { sequence: 500 };
      },
    });

    const pages = await reader.fetchAllInRange(['CA'], 200, 205, 100);
    expect(pages.length).toBeGreaterThanOrEqual(6);
    expect(callCount).toBeLessThanOrEqual(12);
  });
});
