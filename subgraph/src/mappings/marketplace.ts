import { ItemListed, ItemSold } from '../generated/MarketplaceFacet/MarketplaceFacet';
import { MarketplaceEvent } from '../generated/schema';

export function handleItemListed(event: ItemListed): void {
  const eventId = event.transaction.hash.toHex() + '-' + event.logIndex.toString();
  const marketplaceEvent = new MarketplaceEvent(eventId);

  marketplaceEvent.eventType = 'ItemListed';
  marketplaceEvent.seller = event.params.seller.toHex();
  marketplaceEvent.data = event.params.tokenId.toString();
  marketplaceEvent.txHash = event.transaction.hash.toHex();
  marketplaceEvent.ledger = event.block.number;
  marketplaceEvent.createdAt = event.block.timestamp;
  marketplaceEvent.save();
}

export function handleItemSold(event: ItemSold): void {
  const eventId = event.transaction.hash.toHex() + '-' + event.logIndex.toString();
  const marketplaceEvent = new MarketplaceEvent(eventId);

  marketplaceEvent.eventType = 'ItemSold';
  marketplaceEvent.seller = event.params.seller.toHex();
  marketplaceEvent.buyer = event.params.buyer.toHex();
  marketplaceEvent.data = event.params.tokenId.toString();
  marketplaceEvent.txHash = event.transaction.hash.toHex();
  marketplaceEvent.ledger = event.block.number;
  marketplaceEvent.createdAt = event.block.timestamp;
  marketplaceEvent.save();
}
