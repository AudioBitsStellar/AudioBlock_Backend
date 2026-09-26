import {
  AlbumCreated,
  AlbumUpdated,
  SongUploadedSuccessfully,
} from '../generated/AlbumFacet/AlbumFacet';
import { Album, AlbumEvent, Song, Artist, MintEvent } from '../generated/schema';
import { BigInt } from '@graphprotocol/graph-ts';

export function handleAlbumCreated(event: AlbumCreated): void {
  const albumId = event.params.albumId;
  let album = Album.load(albumId);

  const artistId = event.params.artistId;
  let artist = Artist.load(artistId);
  if (!artist) {
    artist = new Artist(artistId);
    artist.wallet = artistId;
    artist.name = 'Artist ' + artistId.slice(0, 6);
    artist.totalTracks = BigInt.fromI32(0);
    artist.totalSalesCount = BigInt.fromI32(0);
    artist.totalVolume = BigInt.fromI32(0);
    artist.createdAt = event.block.timestamp;
    artist.updatedAt = event.block.timestamp;
    artist.save();
  }

  if (!album) {
    album = new Album(albumId);
  }

  album.title = event.params.metadata;
  album.artist = artistId;
  album.createdAt = event.block.timestamp;
  album.updatedAt = event.block.timestamp;
  album.save();

  const eventRecord = new AlbumEvent(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  eventRecord.album = albumId;
  eventRecord.eventType = 'AlbumCreated';
  eventRecord.data = event.params.metadata;
  eventRecord.txHash = event.transaction.hash.toHex();
  eventRecord.ledger = event.block.number;
  eventRecord.createdAt = event.block.timestamp;
  eventRecord.save();
}

export function handleAlbumUpdated(event: AlbumUpdated): void {
  const albumId = event.params.albumId;
  let album = Album.load(albumId);

  if (!album) {
    album = new Album(albumId);
    album.artist = 'unknown';
    album.createdAt = event.block.timestamp;
  }

  album.title = event.params.newMetadata;
  album.updatedAt = event.block.timestamp;
  album.save();

  const eventRecord = new AlbumEvent(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  eventRecord.album = albumId;
  eventRecord.eventType = 'AlbumUpdated';
  eventRecord.data = event.params.newMetadata;
  eventRecord.txHash = event.transaction.hash.toHex();
  eventRecord.ledger = event.block.number;
  eventRecord.createdAt = event.block.timestamp;
  eventRecord.save();
}

export function handleSongUploadedSuccessfully(event: SongUploadedSuccessfully): void {
  const songId = event.params.songId.toString();
  const tokenId = event.params.tokenId;
  const artistId = event.params.artist.toHex();
  const songCid = event.params.songCid;

  let artist = Artist.load(artistId);
  if (!artist) {
    artist = new Artist(artistId);
    artist.wallet = artistId;
    artist.name = 'Artist ' + artistId.slice(0, 6);
    artist.totalTracks = BigInt.fromI32(0);
    artist.totalSalesCount = BigInt.fromI32(0);
    artist.totalVolume = BigInt.fromI32(0);
    artist.createdAt = event.block.timestamp;
  }
  artist.totalTracks = artist.totalTracks.plus(BigInt.fromI32(1));
  artist.updatedAt = event.block.timestamp;
  artist.save();

  let song = Song.load(songId);
  if (!song) {
    song = new Song(songId);
    song.title = 'Track #' + songId;
    song.duration = 0;
    song.ipfsHash = songCid;
    song.isListed = false;
    song.salesCount = BigInt.fromI32(0);
    song.likeCount = BigInt.fromI32(0);
    song.commentCount = BigInt.fromI32(0);
    song.createdAt = event.block.timestamp;
  }

  song.tokenId = tokenId;
  song.artist = artistId;
  song.contentCid = songCid;
  song.owner = artistId;
  song.isMinted = true;
  song.updatedAt = event.block.timestamp;
  song.save();

  const mintEventId = event.transaction.hash.toHex() + '-' + event.logIndex.toString();
  const mintEvent = new MintEvent(mintEventId);
  mintEvent.song = songId;
  mintEvent.artist = artistId;
  mintEvent.minter = artistId;
  mintEvent.tokenId = tokenId;
  mintEvent.tokenUri = songCid;
  mintEvent.txHash = event.transaction.hash.toHex();
  mintEvent.ledger = event.block.number;
  mintEvent.createdAt = event.block.timestamp;
  mintEvent.save();
}
