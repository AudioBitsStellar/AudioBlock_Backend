import { ArtistRegistered, ArtistUpdated } from '../generated/ArtistFacet/ArtistFacet';
import { Artist, ArtistEvent } from '../generated/schema';
import { BigInt } from '@graphprotocol/graph-ts';

export function handleArtistRegistered(event: ArtistRegistered): void {
  const artistId = event.params.wallet.toHex();
  let artist = Artist.load(artistId);

  if (!artist) {
    artist = new Artist(artistId);
    artist.wallet = event.params.wallet.toHex();
    artist.totalTracks = BigInt.fromI32(0);
    artist.totalSalesCount = BigInt.fromI32(0);
    artist.totalVolume = BigInt.fromI32(0);
  }

  artist.name = event.params.name;
  artist.createdAt = event.block.timestamp;
  artist.updatedAt = event.block.timestamp;
  artist.save();

  const eventRecord = new ArtistEvent(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  eventRecord.artist = artistId;
  eventRecord.eventType = 'ArtistRegistered';
  eventRecord.data = event.params.name;
  eventRecord.txHash = event.transaction.hash.toHex();
  eventRecord.ledger = event.block.number;
  eventRecord.createdAt = event.block.timestamp;
  eventRecord.save();
}

export function handleArtistUpdated(event: ArtistUpdated): void {
  const artistId = event.params.wallet.toHex();
  let artist = Artist.load(artistId);

  if (!artist) {
    artist = new Artist(artistId);
    artist.wallet = event.params.wallet.toHex();
    artist.totalTracks = BigInt.fromI32(0);
    artist.totalSalesCount = BigInt.fromI32(0);
    artist.totalVolume = BigInt.fromI32(0);
    artist.createdAt = event.block.timestamp;
  }

  artist.name = event.params.metadata;
  artist.updatedAt = event.block.timestamp;
  artist.save();

  const eventRecord = new ArtistEvent(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  eventRecord.artist = artistId;
  eventRecord.eventType = 'ArtistUpdated';
  eventRecord.data = event.params.metadata;
  eventRecord.txHash = event.transaction.hash.toHex();
  eventRecord.ledger = event.block.number;
  eventRecord.createdAt = event.block.timestamp;
  eventRecord.save();
}
