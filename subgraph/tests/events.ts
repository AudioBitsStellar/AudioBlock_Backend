import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import { newMockEvent } from 'matchstick-as';
import { ArtistRegistered, ArtistUpdated } from '../src/generated/ArtistFacet/ArtistFacet';
import {
  CommentAdded,
  CommentRemoved,
  SongLiked,
  SongMetadataUpdated,
  SongPlayed,
  SongUnliked,
  SongUploaded,
} from '../src/generated/SongFacet/SongFacet';
import {
  AlbumCreated,
  AlbumUpdated,
  SongUploadedSuccessfully,
} from '../src/generated/AlbumFacet/AlbumFacet';
import { Transfer } from '../src/generated/ERC721Facet/ERC721Facet';
import { ItemListed, ItemSold } from '../src/generated/MarketplaceFacet/MarketplaceFacet';
import {
  RoyaltyPayoutProcessed,
  RoyaltySplitCreated,
} from '../src/generated/RoyaltyFacet/RoyaltyFacet';

function withParams(params: ethereum.EventParam[], logIndex: i32): ethereum.Event {
  const event = newMockEvent();
  event.parameters = params;
  event.logIndex = BigInt.fromI32(logIndex);
  return event;
}

export function artistRegistered(
  wallet: Address,
  name: string,
  logIndex: i32 = 0,
): ArtistRegistered {
  return changetype<ArtistRegistered>(
    withParams(
      [
        new ethereum.EventParam('wallet', ethereum.Value.fromAddress(wallet)),
        new ethereum.EventParam('name', ethereum.Value.fromString(name)),
      ],
      logIndex,
    ),
  );
}

export function artistUpdated(wallet: Address, metadata: string, logIndex: i32 = 0): ArtistUpdated {
  return changetype<ArtistUpdated>(
    withParams(
      [
        new ethereum.EventParam('wallet', ethereum.Value.fromAddress(wallet)),
        new ethereum.EventParam('metadata', ethereum.Value.fromString(metadata)),
      ],
      logIndex,
    ),
  );
}

export function songUploaded(
  songId: string,
  artistId: Address,
  contentHash: string,
  metadata: string,
  logIndex: i32 = 0,
): SongUploaded {
  return changetype<SongUploaded>(
    withParams(
      [
        new ethereum.EventParam('songId', ethereum.Value.fromString(songId)),
        new ethereum.EventParam('artistId', ethereum.Value.fromAddress(artistId)),
        new ethereum.EventParam('contentHash', ethereum.Value.fromString(contentHash)),
        new ethereum.EventParam('metadata', ethereum.Value.fromString(metadata)),
      ],
      logIndex,
    ),
  );
}

export function songLiked(songId: string, user: Address, logIndex: i32 = 0): SongLiked {
  return changetype<SongLiked>(
    withParams(
      [
        new ethereum.EventParam('songId', ethereum.Value.fromString(songId)),
        new ethereum.EventParam('user', ethereum.Value.fromAddress(user)),
      ],
      logIndex,
    ),
  );
}

export function songUnliked(songId: string, user: Address, logIndex: i32 = 0): SongUnliked {
  return changetype<SongUnliked>(
    withParams(
      [
        new ethereum.EventParam('songId', ethereum.Value.fromString(songId)),
        new ethereum.EventParam('user', ethereum.Value.fromAddress(user)),
      ],
      logIndex,
    ),
  );
}

export function commentAdded(
  songId: string,
  user: Address,
  commentId: string,
  content: string,
  logIndex: i32 = 0,
): CommentAdded {
  return changetype<CommentAdded>(
    withParams(
      [
        new ethereum.EventParam('songId', ethereum.Value.fromString(songId)),
        new ethereum.EventParam('user', ethereum.Value.fromAddress(user)),
        new ethereum.EventParam('commentId', ethereum.Value.fromString(commentId)),
        new ethereum.EventParam('content', ethereum.Value.fromString(content)),
      ],
      logIndex,
    ),
  );
}

export function commentRemoved(
  songId: string,
  user: Address,
  commentId: string,
  logIndex: i32 = 0,
): CommentRemoved {
  return changetype<CommentRemoved>(
    withParams(
      [
        new ethereum.EventParam('songId', ethereum.Value.fromString(songId)),
        new ethereum.EventParam('user', ethereum.Value.fromAddress(user)),
        new ethereum.EventParam('commentId', ethereum.Value.fromString(commentId)),
      ],
      logIndex,
    ),
  );
}

export function songPlayed(
  songId: string,
  listener: Address,
  durationSeconds: BigInt,
  logIndex: i32 = 0,
): SongPlayed {
  return changetype<SongPlayed>(
    withParams(
      [
        new ethereum.EventParam('songId', ethereum.Value.fromString(songId)),
        new ethereum.EventParam('listener', ethereum.Value.fromAddress(listener)),
        new ethereum.EventParam(
          'durationSeconds',
          ethereum.Value.fromUnsignedBigInt(durationSeconds),
        ),
      ],
      logIndex,
    ),
  );
}

export function songMetadataUpdated(
  songId: string,
  metadata: string,
  logIndex: i32 = 0,
): SongMetadataUpdated {
  return changetype<SongMetadataUpdated>(
    withParams(
      [
        new ethereum.EventParam('songId', ethereum.Value.fromString(songId)),
        new ethereum.EventParam('newMetadata', ethereum.Value.fromString(metadata)),
      ],
      logIndex,
    ),
  );
}

export function albumCreated(
  albumId: string,
  artistId: string,
  metadata: string,
  logIndex: i32 = 0,
): AlbumCreated {
  return changetype<AlbumCreated>(
    withParams(
      [
        new ethereum.EventParam('albumId', ethereum.Value.fromString(albumId)),
        new ethereum.EventParam('artistId', ethereum.Value.fromString(artistId)),
        new ethereum.EventParam('metadata', ethereum.Value.fromString(metadata)),
      ],
      logIndex,
    ),
  );
}

export function albumUpdated(albumId: string, metadata: string, logIndex: i32 = 0): AlbumUpdated {
  return changetype<AlbumUpdated>(
    withParams(
      [
        new ethereum.EventParam('albumId', ethereum.Value.fromString(albumId)),
        new ethereum.EventParam('newMetadata', ethereum.Value.fromString(metadata)),
      ],
      logIndex,
    ),
  );
}

export function songUploadedSuccessfully(
  songId: BigInt,
  tokenId: BigInt,
  artist: Address,
  songCid: string,
  logIndex: i32 = 0,
): SongUploadedSuccessfully {
  return changetype<SongUploadedSuccessfully>(
    withParams(
      [
        new ethereum.EventParam('songId', ethereum.Value.fromUnsignedBigInt(songId)),
        new ethereum.EventParam('tokenId', ethereum.Value.fromUnsignedBigInt(tokenId)),
        new ethereum.EventParam('artist', ethereum.Value.fromAddress(artist)),
        new ethereum.EventParam('songCid', ethereum.Value.fromString(songCid)),
      ],
      logIndex,
    ),
  );
}

export function transfer(from: Address, to: Address, tokenId: BigInt, logIndex: i32 = 0): Transfer {
  return changetype<Transfer>(
    withParams(
      [
        new ethereum.EventParam('from', ethereum.Value.fromAddress(from)),
        new ethereum.EventParam('to', ethereum.Value.fromAddress(to)),
        new ethereum.EventParam('tokenId', ethereum.Value.fromUnsignedBigInt(tokenId)),
      ],
      logIndex,
    ),
  );
}

export function itemListed(
  seller: Address,
  tokenId: string,
  price: BigInt,
  logIndex: i32 = 0,
): ItemListed {
  return changetype<ItemListed>(
    withParams(
      [
        new ethereum.EventParam('seller', ethereum.Value.fromAddress(seller)),
        new ethereum.EventParam('tokenId', ethereum.Value.fromString(tokenId)),
        new ethereum.EventParam('price', ethereum.Value.fromUnsignedBigInt(price)),
      ],
      logIndex,
    ),
  );
}

export function itemSold(
  seller: Address,
  buyer: Address,
  tokenId: string,
  logIndex: i32 = 0,
): ItemSold {
  return changetype<ItemSold>(
    withParams(
      [
        new ethereum.EventParam('seller', ethereum.Value.fromAddress(seller)),
        new ethereum.EventParam('buyer', ethereum.Value.fromAddress(buyer)),
        new ethereum.EventParam('tokenId', ethereum.Value.fromString(tokenId)),
      ],
      logIndex,
    ),
  );
}

export function royaltySplitCreated(royaltyId: string, logIndex: i32 = 0): RoyaltySplitCreated {
  return changetype<RoyaltySplitCreated>(
    withParams(
      [new ethereum.EventParam('royaltyId', ethereum.Value.fromString(royaltyId))],
      logIndex,
    ),
  );
}

export function royaltyPayoutProcessed(
  royaltyId: string,
  logIndex: i32 = 0,
): RoyaltyPayoutProcessed {
  return changetype<RoyaltyPayoutProcessed>(
    withParams(
      [new ethereum.EventParam('royaltyId', ethereum.Value.fromString(royaltyId))],
      logIndex,
    ),
  );
}
