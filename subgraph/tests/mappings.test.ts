import { Address, BigInt } from '@graphprotocol/graph-ts';
import { assert, clearStore, test } from 'matchstick-as/assembly/index';
import { handleArtistRegistered, handleArtistUpdated } from '../src/mappings/artist';
import {
  handleCommentAdded,
  handleCommentRemoved,
  handleSongLiked,
  handleSongMetadataUpdated,
  handleSongPlayed,
  handleSongUnliked,
  handleSongUploaded,
} from '../src/mappings/song';
import {
  handleAlbumCreated,
  handleAlbumUpdated,
  handleSongUploadedSuccessfully,
} from '../src/mappings/album';
import { handleTransfer } from '../src/mappings/erc721';
import { handleItemListed, handleItemSold } from '../src/mappings/marketplace';
import { handleRoyaltyPayoutProcessed, handleRoyaltySplitCreated } from '../src/mappings/royalty';
import {
  albumCreated,
  albumUpdated,
  artistRegistered,
  artistUpdated,
  commentAdded,
  commentRemoved,
  itemListed,
  itemSold,
  royaltyPayoutProcessed,
  royaltySplitCreated,
  songLiked,
  songMetadataUpdated,
  songPlayed,
  songUnliked,
  songUploaded,
  songUploadedSuccessfully,
  transfer,
} from './events';

const artist = Address.fromString('0x00000000000000000000000000000000000000a1');
const listener = Address.fromString('0x00000000000000000000000000000000000000b2');
const buyer = Address.fromString('0x00000000000000000000000000000000000000c3');

test('artist handlers initialize aggregates and record registration and updates', () => {
  clearStore();
  const artistId = artist.toHex();

  handleArtistRegistered(artistRegistered(artist, 'AudioBlock Artist'));
  handleArtistUpdated(artistUpdated(artist, 'Updated profile', 1));

  assert.fieldEquals('Artist', artistId, 'name', 'Updated profile');
  assert.fieldEquals('Artist', artistId, 'totalPlays', '0');
  assert.fieldEquals('Artist', artistId, 'totalEarnings', '0');
  assert.entityCount('ArtistEvent', 2);
});

test('song upload initializes queryable counters and engagement handlers update the song', () => {
  clearStore();
  const songId = 'song-1';

  handleSongUploaded(songUploaded(songId, artist, 'bafy-content', 'First track'));
  handleSongLiked(songLiked(songId, listener, 1));
  handleSongMetadataUpdated(songMetadataUpdated(songId, 'Renamed track', 2));

  assert.fieldEquals('Song', songId, 'title', 'Renamed track');
  assert.fieldEquals('Song', songId, 'likeCount', '1');
  assert.fieldEquals('Song', songId, 'playCount', '0');
  assert.fieldEquals('Song', songId, 'royaltyEarnings', '0');
  assert.entityCount('Like', 1);
  assert.entityCount('SongEvent', 2);
});

test('like, comment, and play handlers update current state and retain activity history', () => {
  clearStore();
  const songId = 'song-engagement';

  handleSongUploaded(songUploaded(songId, artist, 'bafy-content', 'Engagement track'));
  handleSongLiked(songLiked(songId, listener, 1));
  handleSongUnliked(songUnliked(songId, listener, 2));
  handleCommentAdded(commentAdded(songId, listener, 'comment-1', 'Great track', 3));
  handleCommentRemoved(commentRemoved(songId, listener, 'comment-1', 4));
  handleSongPlayed(songPlayed(songId, listener, BigInt.fromI32(45), 5));

  assert.fieldEquals('Song', songId, 'likeCount', '0');
  assert.fieldEquals('Song', songId, 'commentCount', '0');
  assert.fieldEquals('Song', songId, 'playCount', '1');
  assert.fieldEquals('Artist', artist.toHex(), 'totalPlays', '1');
  assert.entityCount('Like', 0);
  assert.entityCount('Comment', 0);
  assert.entityCount('LikeEvent', 2);
  assert.entityCount('CommentEvent', 2);
  assert.entityCount('PlayEvent', 1);
});

test('metadata updates for unknown songs do not persist an invalid required relation', () => {
  clearStore();

  handleSongMetadataUpdated(songMetadataUpdated('missing-song', 'Metadata'));

  assert.entityCount('Song', 0);
  assert.entityCount('SongEvent', 0);
});

test('album creation and successful song upload create related entities', () => {
  clearStore();
  const artistId = artist.toHex();

  handleAlbumCreated(albumCreated('album-1', artistId, 'First album'));
  handleSongUploadedSuccessfully(
    songUploadedSuccessfully(BigInt.fromI32(42), BigInt.fromI32(101), artist, 'bafy-song', 1),
  );

  assert.fieldEquals('Album', 'album-1', 'artist', artistId);
  assert.fieldEquals('Song', '42', 'artist', artistId);
  assert.fieldEquals('Song', '42', 'isMinted', 'true');
  assert.fieldEquals('Song', '42', 'playCount', '0');
  assert.entityCount('MintEvent', 1);
});

test('album update changes an existing album and ignores an update without its parent', () => {
  clearStore();
  handleAlbumCreated(albumCreated('album-1', artist.toHex(), 'First album'));
  handleAlbumUpdated(albumUpdated('album-1', 'Updated album', 1));
  handleAlbumUpdated(albumUpdated('missing-album', 'Orphan update', 2));

  assert.fieldEquals('Album', 'album-1', 'title', 'Updated album');
  assert.entityCount('Album', 1);
  assert.entityCount('AlbumEvent', 2);
});

test('transfer mapping records ownership and initializes a queryable song', () => {
  clearStore();

  handleTransfer(transfer(Address.zero(), artist, BigInt.fromI32(101)));

  assert.fieldEquals('Song', '101', 'owner', artist.toHex());
  assert.fieldEquals('Song', '101', 'isMinted', 'true');
  assert.fieldEquals('Song', '101', 'playCount', '0');
  assert.entityCount('TransferEvent', 1);
  assert.entityCount('MintEvent', 1);
});

test('marketplace listing and sale update song and artist aggregates', () => {
  clearStore();
  const songId = '101';

  handleArtistRegistered(artistRegistered(artist, 'AudioBlock Artist'));
  handleSongUploaded(songUploaded(songId, artist, 'bafy-content', 'Listed track', 1));
  handleItemListed(itemListed(artist, songId, BigInt.fromI32(500), 2));
  handleItemSold(itemSold(artist, buyer, songId, 3));

  assert.fieldEquals('Song', songId, 'owner', buyer.toHex());
  assert.fieldEquals('Song', songId, 'isListed', 'false');
  assert.fieldEquals('Song', songId, 'salesCount', '1');
  assert.fieldEquals('Artist', artist.toHex(), 'totalSalesCount', '1');
  assert.fieldEquals('Artist', artist.toHex(), 'totalVolume', '500');
  assert.entityCount('Sale', 1);
});

test('royalty split handler records an event without inventing event-missing fields', () => {
  clearStore();

  handleRoyaltySplitCreated(royaltySplitCreated('royalty-1'));
  handleRoyaltyPayoutProcessed(royaltyPayoutProcessed('royalty-1', 1));

  assert.entityCount('Royalty', 1);
  assert.entityCount('RoyaltyEvent', 2);
});
