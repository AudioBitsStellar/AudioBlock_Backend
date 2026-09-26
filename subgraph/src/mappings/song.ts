import {
  SongUploaded,
  SongMetadataUpdated,
  SongLiked,
  SongUnliked,
  CommentAdded,
  CommentRemoved,
} from '../generated/SongFacet/SongFacet';
import { Song, SongEvent, Artist, Like, LikeEvent, Comment, CommentEvent } from '../generated/schema';
import { BigInt, store } from '@graphprotocol/graph-ts';

export function handleSongUploaded(event: SongUploaded): void {
  const songId = event.params.songId;
  let song = Song.load(songId);

  const artistId = event.params.artistId.toHex();
  let artist = Artist.load(artistId);
  if (!artist) {
    artist = new Artist(artistId);
    artist.wallet = artistId;
    artist.name = 'Unknown Artist';
    artist.totalTracks = BigInt.fromI32(0);
    artist.totalSalesCount = BigInt.fromI32(0);
    artist.totalVolume = BigInt.fromI32(0);
    artist.createdAt = event.block.timestamp;
    artist.updatedAt = event.block.timestamp;
  }
  artist.totalTracks = artist.totalTracks.plus(BigInt.fromI32(1));
  artist.updatedAt = event.block.timestamp;
  artist.save();

  if (!song) {
    song = new Song(songId);
    song.duration = 0;
    song.isListed = false;
    song.isMinted = false;
    song.salesCount = BigInt.fromI32(0);
    song.likeCount = BigInt.fromI32(0);
    song.commentCount = BigInt.fromI32(0);
  }

  song.title = event.params.metadata;
  song.ipfsHash = event.params.contentHash;
  song.artist = artistId;
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
    song.duration = 0;
    song.isListed = false;
    song.isMinted = false;
    song.salesCount = BigInt.fromI32(0);
    song.likeCount = BigInt.fromI32(0);
    song.commentCount = BigInt.fromI32(0);
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

export function handleSongLiked(event: SongLiked): void {
  const songId = event.params.songId;
  const user = event.params.user.toHex();
  const likeId = songId + '-' + user;

  let song = Song.load(songId);
  if (!song) {
    return;
  }

  let like = Like.load(likeId);
  if (!like) {
    like = new Like(likeId);
    like.song = songId;
    like.user = user;
    like.createdAt = event.block.timestamp;
    like.txHash = event.transaction.hash.toHex();
    like.save();

    song.likeCount = song.likeCount.plus(BigInt.fromI32(1));
    song.updatedAt = event.block.timestamp;
    song.save();
  }

  const likeEventId = event.transaction.hash.toHex() + '-' + event.logIndex.toString();
  const likeEvent = new LikeEvent(likeEventId);
  likeEvent.song = songId;
  likeEvent.user = user;
  likeEvent.eventType = 'Liked';
  likeEvent.txHash = event.transaction.hash.toHex();
  likeEvent.ledger = event.block.number;
  likeEvent.createdAt = event.block.timestamp;
  likeEvent.save();
}

export function handleSongUnliked(event: SongUnliked): void {
  const songId = event.params.songId;
  const user = event.params.user.toHex();
  const likeId = songId + '-' + user;

  let song = Song.load(songId);
  if (!song) {
    return;
  }

  let like = Like.load(likeId);
  if (like) {
    store.remove('Like', likeId);

    if (song.likeCount.gt(BigInt.fromI32(0))) {
      song.likeCount = song.likeCount.minus(BigInt.fromI32(1));
      song.updatedAt = event.block.timestamp;
      song.save();
    }
  }

  const likeEventId = event.transaction.hash.toHex() + '-' + event.logIndex.toString();
  const likeEvent = new LikeEvent(likeEventId);
  likeEvent.song = songId;
  likeEvent.user = user;
  likeEvent.eventType = 'Unliked';
  likeEvent.txHash = event.transaction.hash.toHex();
  likeEvent.ledger = event.block.number;
  likeEvent.createdAt = event.block.timestamp;
  likeEvent.save();
}

export function handleCommentAdded(event: CommentAdded): void {
  const songId = event.params.songId;
  const author = event.params.user.toHex();
  const commentId = event.params.commentId;

  let song = Song.load(songId);
  if (!song) {
    return;
  }

  let comment = Comment.load(commentId);
  if (!comment) {
    comment = new Comment(commentId);
    comment.song = songId;
    comment.author = author;
    comment.content = event.params.content;
    comment.createdAt = event.block.timestamp;
    comment.updatedAt = event.block.timestamp;
    comment.txHash = event.transaction.hash.toHex();
    comment.save();

    song.commentCount = song.commentCount.plus(BigInt.fromI32(1));
    song.updatedAt = event.block.timestamp;
    song.save();
  }

  const commentEventId = event.transaction.hash.toHex() + '-' + event.logIndex.toString();
  const commentEvent = new CommentEvent(commentEventId);
  commentEvent.song = songId;
  commentEvent.author = author;
  commentEvent.eventType = 'CommentAdded';
  commentEvent.content = event.params.content;
  commentEvent.txHash = event.transaction.hash.toHex();
  commentEvent.ledger = event.block.number;
  commentEvent.createdAt = event.block.timestamp;
  commentEvent.save();
}

export function handleCommentRemoved(event: CommentRemoved): void {
  const songId = event.params.songId;
  const author = event.params.user.toHex();
  const commentId = event.params.commentId;

  let song = Song.load(songId);
  if (song && song.commentCount.gt(BigInt.fromI32(0))) {
    song.commentCount = song.commentCount.minus(BigInt.fromI32(1));
    song.updatedAt = event.block.timestamp;
    song.save();
  }

  let comment = Comment.load(commentId);
  if (comment) {
    store.remove('Comment', commentId);
  }

  const commentEventId = event.transaction.hash.toHex() + '-' + event.logIndex.toString();
  const commentEvent = new CommentEvent(commentEventId);
  commentEvent.song = songId;
  commentEvent.author = author;
  commentEvent.eventType = 'CommentRemoved';
  commentEvent.txHash = event.transaction.hash.toHex();
  commentEvent.ledger = event.block.number;
  commentEvent.createdAt = event.block.timestamp;
  commentEvent.save();
}
