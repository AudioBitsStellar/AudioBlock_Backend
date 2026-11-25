import { StrKey } from '@stellar/stellar-sdk';

const repoMock = {
  create: jest.fn((value) => value),
  save: jest.fn(async (value) => ({ id: 'template-1', ...value })),
  findOneBy: jest.fn(),
  find: jest.fn(),
  remove: jest.fn(),
};

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn(() => repoMock) },
}));

import { RoyaltyTemplateService } from '../RoyaltyTemplateService';

describe('RoyaltyTemplateService security rules (#756)', () => {
  const addressA = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
  const addressB = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));

  beforeEach(() => jest.clearAllMocks());

  it('rejects invalid Stellar recipients', async () => {
    const service = new RoyaltyTemplateService();
    await expect(
      service.create({
        name: 'Bad',
        userId: 'artist-a',
        splits: [{ userId: 'u1', role: 'producer', percentage: 100, stellarAddress: 'not-a-key' }],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects duplicate recipients and totals other than 100', async () => {
    const service = new RoyaltyTemplateService();
    await expect(
      service.create({
        name: 'Duplicate',
        userId: 'artist-a',
        splits: [
          { userId: 'u1', role: 'producer', percentage: 50, stellarAddress: addressA },
          { userId: 'u2', role: 'writer', percentage: 50, stellarAddress: addressA },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      service.create({
        name: 'Bad total',
        userId: 'artist-a',
        splits: [
          { userId: 'u1', role: 'producer', percentage: 60, stellarAddress: addressA },
          { userId: 'u2', role: 'writer', percentage: 30, stellarAddress: addressB },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('prevents Artist B from reading Artist A template', async () => {
    repoMock.findOneBy.mockResolvedValue({ id: 't1', userId: 'artist-a' });
    const service = new RoyaltyTemplateService();
    await expect(service.findOwnedById('t1', 'artist-b')).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
