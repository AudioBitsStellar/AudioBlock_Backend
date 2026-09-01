import { EVENT_DECODERS, ALL_CONTRACT_TYPES } from '../services/Soroban/eventDecoders';
import { NormalizedContractEvent } from '../services/Soroban/SorobanEventReader';

function makeEvent(
  overrides: Partial<NormalizedContractEvent> & {
    topic: unknown[];
    value: unknown;
    id?: string;
    ledger?: number;
    txHash?: string;
    contractId?: string | null;
  },
): NormalizedContractEvent {
  return {
    id: overrides.id ?? 'evt-1',
    ledger: overrides.ledger ?? 100,
    txHash: overrides.txHash ?? 'tx-hash-1',
    contractId: overrides.contractId ?? null,
    topic: overrides.topic,
    value: overrides.value,
  };
}

describe('Soroban event decoders', () => {
  it('exposes decoders for all 5 contract types', () => {
    expect(ALL_CONTRACT_TYPES).toEqual(['nft', 'artist', 'catalog', 'royalty', 'marketplace']);
    for (const type of ALL_CONTRACT_TYPES) {
      expect(EVENT_DECODERS[type].contractType).toBe(type);
    }
  });

  describe('nft', () => {
    it('decodes a mint event', () => {
      const dto = EVENT_DECODERS.nft.decode(
        makeEvent({ topic: [{ symbol: 'mint' }, 'GOWNER123'], value: 'token-42' }),
      );
      expect(dto).toMatchObject({
        contractType: 'nft',
        eventType: 'mint',
        eventId: 'evt-1',
        ledger: 100,
        txHash: 'tx-hash-1',
        address: 'GOWNER123',
      });
    });

    it('decodes a transfer event', () => {
      const dto = EVENT_DECODERS.nft.decode(
        makeEvent({
          topic: [{ symbol: 'transfer' }, 'token-1', 'GFROM', 'GTO'],
          value: null,
        }),
      );
      expect(dto).toMatchObject({ eventType: 'transfer', address: 'GTO' });
    });

    it('returns null for unknown events', () => {
      expect(
        EVENT_DECODERS.nft.decode(makeEvent({ topic: [{ symbol: 'other' }], value: null })),
      ).toBeNull();
    });
  });

  describe('artist', () => {
    it('decodes artist_registered', () => {
      const dto = EVENT_DECODERS.artist.decode(
        makeEvent({
          topic: [{ symbol: 'artist_registered' }, 'GARTIST'],
          value: { verified: true },
        }),
      );
      expect(dto).toMatchObject({ eventType: 'artist_registered', address: 'GARTIST' });
    });
  });

  describe('catalog', () => {
    it('decodes song_registered', () => {
      const dto = EVENT_DECODERS.catalog.decode(
        makeEvent({
          topic: [{ symbol: 'song_registered' }, 'song-1', 'GARTIST'],
          value: { uri: 'ipfs://x' },
        }),
      );
      expect(dto).toMatchObject({ eventType: 'song_registered', address: 'GARTIST' });
    });
  });

  describe('royalty', () => {
    it('decodes royalty_payout from structured payload', () => {
      const dto = EVENT_DECODERS.royalty.decode(
        makeEvent({
          topic: [{ symbol: 'royalty_payout' }],
          value: { saleEventId: 's1', recipient: 'GPAYEE', amountStroops: '1000' },
        }),
      );
      expect(dto).toMatchObject({ eventType: 'royalty_payout', address: 'GPAYEE' });
    });

    it('decodes royalty_payout from topic args', () => {
      const dto = EVENT_DECODERS.royalty.decode(
        makeEvent({
          topic: [{ symbol: 'royalty_payout' }, { address: 'GPAYEE' }, '500'],
          value: null,
        }),
      );
      expect(dto).toMatchObject({ eventType: 'royalty_payout', address: 'GPAYEE' });
    });
  });

  describe('marketplace', () => {
    it('decodes a sale event', () => {
      const dto = EVENT_DECODERS.marketplace.decode(
        makeEvent({
          topic: [{ symbol: 'sale' }, 'listing-9', 'GBUYER', '7500'],
          value: null,
        }),
      );
      expect(dto).toMatchObject({ eventType: 'sale', address: 'GBUYER' });
    });

    it('decodes listing_created', () => {
      const dto = EVENT_DECODERS.marketplace.decode(
        makeEvent({
          topic: [{ symbol: 'listing_created' }, 'listing-1', 'GSELLER'],
          value: { price: '100' },
        }),
      );
      expect(dto).toMatchObject({ eventType: 'listing_created', address: 'GSELLER' });
    });
  });
});
