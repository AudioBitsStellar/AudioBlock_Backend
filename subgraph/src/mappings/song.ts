import { SongUploaded, SongMetadataUpdated } from '../generated/SongFacet/SongFacet';
import { Song, SongEvent, Artist } from '../generated/schema';

export function handleSongUploaded(event: SongUploaded): void {
  const songId = event.params.songId;
  let song = Song.load(songId);

  if (!song) {
    song = new Song(songId);
  }

  song.title = event.params.metadata;
  song.ipfsHash = event.params.contentHash;
  song.artist = event.params.artistId;
  song.createdAt = event.block.timestamp;
  song.updatedAt = event.block.timestamp;
  song.save();

  const eventRecord = new SongEvent(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  eventRecord.song = songId;
  eventRecord.eventType = 'SongUploaded';
  eventRecord.data = event.params.metadata;
  eventRecord.txHash = event.transaction.hash.toHex();
  eventRecord.ledger = event.block.number;
  eventRecord.createdAt = event.block.timestamp;
  eventRecord.save();
}

export function handleSongMetadataUpdated(event: SongMetadataUpdated): void {
  const songId = event.params.songId;
  let song = Song.load(songId);

  if (!song) {
    song = new Song(songId);
    song.createdAt = event.block.timestamp;
  }

  song.title = event.params.newMetadata;
  song.updatedAt = event.block.timestamp;
  song.save();

  const eventRecord = new SongEvent(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  eventRecord.song = songId;
  eventRecord.eventType = 'SongMetadataUpdated';
  eventRecord.data = event.params.newMetadata;
  eventRecord.txHash = event.transaction.hash.toHex();
  eventRecord.ledger = event.block.number;
  eventRecord.createdAt = event.block.timestamp;
  eventRecord.save();
}
