import { ItemListed, ItemSold } from '../generated/MarketplaceFacet/MarketplaceFacet';
import { MarketplaceEvent, Sale, Song, Artist } from '../generated/schema';
import { BigInt } from '@graphprotocol/graph-ts';

export function handleItemListed(event: ItemListed): void {
  const eventId = event.transaction.hash.toHex() + '-' + event.logIndex.toString();
  const marketplaceEvent = new MarketplaceEvent(eventId);

  const seller = event.params.seller.toHex();
  const tokenId = event.params.tokenId;
  const price = event.params.price;

  marketplaceEvent.eventType = 'ItemListed';
  marketplaceEvent.seller = seller;
  marketplaceEvent.data = tokenId;
  marketplaceEvent.txHash = event.transaction.hash.toHex();
  marketplaceEvent.ledger = event.block.number;
  marketplaceEvent.createdAt = event.block.timestamp;
  marketplaceEvent.save();

  let song = Song.load(tokenId);
  if (song) {
    song.isListed = true;
    song.price = price;
    song.updatedAt = event.block.timestamp;
    song.save();
  }
}

export function handleItemSold(event: ItemSold): void {
  const eventId = event.transaction.hash.toHex() + '-' + event.logIndex.toString();
  const marketplaceEvent = new MarketplaceEvent(eventId);

  const seller = event.params.seller.toHex();
  const buyer = event.params.buyer.toHex();
  const tokenId = event.params.tokenId;

  marketplaceEvent.eventType = 'ItemSold';
  marketplaceEvent.seller = seller;
  marketplaceEvent.buyer = buyer;
  marketplaceEvent.data = tokenId;
  marketplaceEvent.txHash = event.transaction.hash.toHex();
  marketplaceEvent.ledger = event.block.number;
  marketplaceEvent.createdAt = event.block.timestamp;
  marketplaceEvent.save();

  let song = Song.load(tokenId);
  let artistId = 'unknown';
  let price = BigInt.fromI32(0);

  if (song) {
    artistId = song.artist;
    if (song.price) {
      price = song.price as BigInt;
    }
    song.owner = buyer;
    song.isListed = false;
    song.salesCount = song.salesCount.plus(BigInt.fromI32(1));
    song.updatedAt = event.block.timestamp;
    song.save();

    let artist = Artist.load(artistId);
    if (artist) {
      artist.totalSalesCount = artist.totalSalesCount.plus(BigInt.fromI32(1));
      artist.totalVolume = artist.totalVolume.plus(price);
      artist.updatedAt = event.block.timestamp;
      artist.save();
    }
  }

  const sale = new Sale(eventId);
  sale.song = tokenId;
  sale.artist = artistId;
  sale.seller = seller;
  sale.buyer = buyer;
  sale.price = price;
  sale.tokenId = BigInt.fromString(tokenId.length > 0 ? tokenId : '0');
  sale.txHash = event.transaction.hash.toHex();
  sale.ledger = event.block.number;
  sale.createdAt = event.block.timestamp;
  sale.save();
}
