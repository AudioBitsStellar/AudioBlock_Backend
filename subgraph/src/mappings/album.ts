import { AlbumCreated, AlbumUpdated } from '../generated/AlbumFacet/AlbumFacet';
import { Album, AlbumEvent } from '../generated/schema';

export function handleAlbumCreated(event: AlbumCreated): void {
  const albumId = event.params.albumId;
  let album = Album.load(albumId);

  if (!album) {
    album = new Album(albumId);
  }

  album.title = event.params.metadata;
  album.artist = event.params.artistId;
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
