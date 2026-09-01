/**
 * Per-contract-type event decoders (Issue #234).
 *
 * Each decoder understands the on-chain events emitted by its contract and
 * maps a normalized Soroban event to a database row for the `indexed_events`
 * table. The `contractType` discriminates which decoder to use and is stored
 * on every row.
 *
 * Contract types (matching `docs/database-schema.md`):
 *   - nft           (mint, transfer)
 *   - artist        (artist_registered, profile_updated)
 *   - catalog       (song_registered, album_created)
 *   - royalty       (royalty_payout)
 *   - marketplace   (listing_created, sale, listing_cancelled)
 */
import { InsertIndexedEventDTO } from '../IndexedEventService';
import { NormalizedContractEvent } from './SorobanEventReader';

export type ContractType = 'nft' | 'artist' | 'catalog' | 'royalty' | 'marketplace';

export interface SorobanEventDecoder {
  readonly contractType: ContractType;
  /**
   * Decode a normalized event into a row for `indexed_events`, or return null
   * if the event is not one this decoder handles.
   */
  decode(event: NormalizedContractEvent): InsertIndexedEventDTO | null;
}

/** Extract the event symbol name from the first topic element. */
function eventSymbol(topic: unknown[]): string {
  const first = topic[0];
  if (typeof first === 'object' && first !== null) {
    const rec = first as Record<string, unknown>;
    if (typeof rec.symbol === 'string') return rec.symbol;
    if (typeof rec.name === 'string') return rec.name;
  }
  return typeof first === 'string' ? first : '';
}

function baseDTO(
  event: NormalizedContractEvent,
  decoder: SorobanEventDecoder,
  eventType: string,
  payload: Record<string, unknown>,
): InsertIndexedEventDTO {
  return {
    contractId: event.contractId ?? undefined,
    contractType: decoder.contractType,
    eventType,
    eventId: event.id,
    txHash: event.txHash || undefined,
    ledger: event.ledger,
    payload,
  };
}

function addressOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const rec = value as Record<string, unknown>;
    if (typeof rec.address === 'string') return rec.address;
    if (typeof rec.key === 'string') return rec.key;
  }
  return undefined;
}

const nftDecoder: SorobanEventDecoder = {
  contractType: 'nft',
  decode(event) {
    const symbol = eventSymbol(event.topic);
    if (symbol === 'mint') {
      const payload = {
        tokenId: event.value ?? null,
        owner: addressOf(event.topic[1]),
      };
      return {
        ...baseDTO(event, this, 'mint', payload),
        address: addressOf(event.topic[1]),
      };
    }
    if (symbol === 'transfer') {
      const payload = {
        tokenId: event.topic[1] ?? null,
        from: addressOf(event.topic[2]),
        to: addressOf(event.topic[3] ?? event.value),
      };
      return {
        ...baseDTO(event, this, 'transfer', payload),
        address: addressOf(event.topic[3] ?? event.value),
      };
    }
    return null;
  },
};

const artistDecoder: SorobanEventDecoder = {
  contractType: 'artist',
  decode(event) {
    const symbol = eventSymbol(event.topic);
    if (symbol === 'artist_registered') {
      return {
        ...baseDTO(event, this, 'artist_registered', {
          artist: event.topic[1] ?? null,
          payload: event.value,
        }),
        address: addressOf(event.topic[1] ?? event.value),
      };
    }
    if (symbol === 'profile_updated') {
      return {
        ...baseDTO(event, this, 'profile_updated', {
          artist: event.topic[1] ?? null,
          changes: event.value,
        }),
        address: addressOf(event.topic[1] ?? event.value),
      };
    }
    return null;
  },
};

const catalogDecoder: SorobanEventDecoder = {
  contractType: 'catalog',
  decode(event) {
    const symbol = eventSymbol(event.topic);
    if (symbol === 'song_registered') {
      return {
        ...baseDTO(event, this, 'song_registered', {
          songId: event.topic[1] ?? null,
          data: event.value,
        }),
        address: addressOf(event.topic[2] ?? event.value),
      };
    }
    if (symbol === 'album_created') {
      return {
        ...baseDTO(event, this, 'album_created', {
          albumId: event.topic[1] ?? null,
          data: event.value,
        }),
        address: addressOf(event.topic[2] ?? event.value),
      };
    }
    return null;
  },
};

const royaltyDecoder: SorobanEventDecoder = {
  contractType: 'royalty',
  decode(event) {
    const symbol = eventSymbol(event.topic);
    if (symbol === 'royalty_payout') {
      const payload = (event.value as Record<string, unknown> | null) || {
        recipient: event.topic[1] ?? null,
        amountStroops: event.topic[2] ?? null,
      };
      return {
        ...baseDTO(event, this, 'royalty_payout', payload),
        address: addressOf(payload.recipient ?? event.topic[1] ?? payload.recipientPublicKey),
      };
    }
    return null;
  },
};

const marketplaceDecoder: SorobanEventDecoder = {
  contractType: 'marketplace',
  decode(event) {
    const symbol = eventSymbol(event.topic);
    if (symbol === 'listing_created') {
      return {
        ...baseDTO(event, this, 'listing_created', {
          listing: event.topic[1] ?? null,
          seller: event.topic[2] ?? null,
          data: event.value,
        }),
        address: addressOf(event.topic[2] ?? event.value),
      };
    }
    if (symbol === 'sale') {
      return {
        ...baseDTO(event, this, 'sale', {
          listing: event.topic[1] ?? null,
          buyer: event.topic[2] ?? null,
          amountStroops: event.topic[3] ?? null,
          data: event.value,
        }),
        address: addressOf(event.topic[2] ?? event.value),
      };
    }
    if (symbol === 'listing_cancelled') {
      return {
        ...baseDTO(event, this, 'listing_cancelled', {
          listing: event.topic[1] ?? null,
        }),
        address: undefined,
      };
    }
    return null;
  },
};

/** Registry of decoders keyed by contract type. */
export const EVENT_DECODERS: Record<ContractType, SorobanEventDecoder> = {
  nft: nftDecoder,
  artist: artistDecoder,
  catalog: catalogDecoder,
  royalty: royaltyDecoder,
  marketplace: marketplaceDecoder,
};

export const ALL_CONTRACT_TYPES: ContractType[] = [
  'nft',
  'artist',
  'catalog',
  'royalty',
  'marketplace',
];
