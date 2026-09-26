import { RoyaltySplitCreated, RoyaltyPayoutProcessed } from '../generated/RoyaltyFacet/RoyaltyFacet';
import { Royalty, RoyaltyEvent } from '../generated/schema';

export function handleRoyaltySplitCreated(event: RoyaltySplitCreated): void {
  const royaltyId = event.params.royaltyId;
  let royalty = Royalty.load(royaltyId);

  if (!royalty) {
    royalty = new Royalty(royaltyId);
  }

  royalty.createdAt = event.block.timestamp;
  royalty.updatedAt = event.block.timestamp;
  royalty.save();

  const eventRecord = new RoyaltyEvent(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  eventRecord.royalty = royaltyId;
  eventRecord.eventType = 'RoyaltySplitCreated';
  eventRecord.data = event.params.royaltyId;
  eventRecord.txHash = event.transaction.hash.toHex();
  eventRecord.ledger = event.block.number;
  eventRecord.createdAt = event.block.timestamp;
  eventRecord.save();
}

export function handleRoyaltyPayoutProcessed(event: RoyaltyPayoutProcessed): void {
  const royaltyId = event.params.royaltyId;
  let royalty = Royalty.load(royaltyId);

  if (!royalty) {
    royalty = new Royalty(royaltyId);
    royalty.createdAt = event.block.timestamp;
  }

  royalty.updatedAt = event.block.timestamp;
  royalty.save();

  const eventRecord = new RoyaltyEvent(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  eventRecord.royalty = royaltyId;
  eventRecord.eventType = 'RoyaltyPayoutProcessed';
  eventRecord.data = event.params.royaltyId;
  eventRecord.txHash = event.transaction.hash.toHex();
  eventRecord.ledger = event.block.number;
  eventRecord.createdAt = event.block.timestamp;
  eventRecord.save();
}
