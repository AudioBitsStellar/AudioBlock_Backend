import 'reflect-metadata';
import { Account, Keypair, StrKey } from '@stellar/stellar-sdk';

const mockServer = {
  getFeeStats: jest.fn(),
  getAccount: jest.fn(),
  prepareTransaction: jest.fn(),
};

jest.mock('../../../config/soroban', () => ({
  getNetworkPassphrase: () => 'Test SDF Network ; September 2015',
  getSorobanServer: () => mockServer,
}));

import { SorobanService } from '../SorobanService';

const feeStats = (p70: string) => ({
  latestLedger: 100,
  inclusionFee: { p70 },
  sorobanInclusionFee: { p70, p80: '800' },
});

describe('SorobanService inclusion fee selection', () => {
  const source = Keypair.random().publicKey();
  const contractId = StrKey.encodeContract(Buffer.alloc(32));

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SOROBAN_INCLUSION_FEE_PERCENTILE;
    delete process.env.SOROBAN_MAX_INCLUSION_FEE;
    mockServer.getAccount.mockResolvedValue(new Account(source, '1'));
    mockServer.prepareTransaction.mockImplementation(async (transaction) => transaction);
  });

  it('uses the configured percentile fee, bounded by the maximum, and caches fee stats', async () => {
    process.env.SOROBAN_MAX_INCLUSION_FEE = '1000';
    mockServer.getFeeStats.mockResolvedValue(feeStats('5000'));
    const service = new SorobanService();

    const first = await service.prepareInvocation(source, contractId, 'test', []);
    const second = await service.prepareInvocation(source, contractId, 'test', []);

    expect(first.inclusionFee).toBe('1000');
    expect(mockServer.prepareTransaction.mock.calls[0][0].fee).toBe('1000');
    expect(second.inclusionFee).toBe('1000');
    expect(mockServer.getFeeStats).toHaveBeenCalledTimes(1);
  });

  it('uses BASE_FEE when the network percentile is lower', async () => {
    mockServer.getFeeStats.mockResolvedValue(feeStats('1'));

    const prepared = await new SorobanService().prepareInvocation(source, contractId, 'test', []);

    expect(prepared.inclusionFee).toBe('100');
    expect(mockServer.prepareTransaction.mock.calls[0][0].fee).toBe('100');
  });

  it('uses the configured fee-stat percentile', async () => {
    process.env.SOROBAN_INCLUSION_FEE_PERCENTILE = '80';
    mockServer.getFeeStats.mockResolvedValue(feeStats('500'));

    const prepared = await new SorobanService().prepareInvocation(source, contractId, 'test', []);

    expect(prepared.inclusionFee).toBe('800');
  });
});
