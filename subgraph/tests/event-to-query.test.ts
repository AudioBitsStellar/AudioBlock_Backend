import { Address, BigInt } from '@graphprotocol/graph-ts';
import { assert, clearStore, test } from 'matchstick-as/assembly/index';
import { handleArtistRegistered } from '../src/mappings/artist';
import { handleSongUploaded } from '../src/mappings/song';
import { handleItemListed, handleItemSold } from '../src/mappings/marketplace';
import { artistRegistered, itemListed, itemSold, songUploaded } from './events';

test('contract events produce linked entities and fields used by GraphQL queries', () => {
  clearStore();
  const artist = Address.fromString('0x00000000000000000000000000000000000000a1');
  const buyer = Address.fromString('0x00000000000000000000000000000000000000c3');
  const artistId = artist.toHex();
  const songId = '101';

  const registration = artistRegistered(artist, 'AudioBlock Artist', 0);
  const upload = songUploaded(songId, artist, 'bafy-content', 'First track', 1);
  const listing = itemListed(artist, songId, BigInt.fromI32(500), 2);
  const sale = itemSold(artist, buyer, songId, 3);

  handleArtistRegistered(registration);
  handleSongUploaded(upload);
  handleItemListed(listing);
  handleItemSold(sale);

  assert.fieldEquals(
    'ArtistEvent',
    registration.transaction.hash.toHex() + '-0',
    'artist',
    artistId,
  );
  assert.fieldEquals('SongEvent', upload.transaction.hash.toHex() + '-1', 'song', songId);
  assert.fieldEquals('Song', songId, 'artist', artistId);
  assert.fieldEquals('Song', songId, 'owner', buyer.toHex());
  assert.fieldEquals('Song', songId, 'price', '500');
  assert.fieldEquals('Sale', sale.transaction.hash.toHex() + '-3', 'song', songId);
  assert.fieldEquals('Sale', sale.transaction.hash.toHex() + '-3', 'artist', artistId);
  assert.fieldEquals('Sale', sale.transaction.hash.toHex() + '-3', 'buyer', buyer.toHex());
  assert.fieldEquals('Artist', artistId, 'totalTracks', '1');
  assert.fieldEquals('Artist', artistId, 'totalSalesCount', '1');
  assert.fieldEquals('Artist', artistId, 'totalVolume', '500');
});
