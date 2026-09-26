import { Transfer } from '../generated/ERC721Facet/ERC721Facet';
import { Song, TransferEvent, MintEvent, Artist } from '../generated/schema';
import { BigInt, Address } from '@graphprotocol/graph-ts';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function handleTransfer(event: Transfer): void {
  const tokenId = event.params.tokenId;
  const songId = tokenId.toString();
  const from = event.params.from.toHex();
  const to = event.params.to.toHex();

  let song = Song.load(songId);
  if (!song) {
    song = new Song(songId);
    song.title = 'Track #' + songId;
    song.artist = to;
    song.duration = 0;
    song.ipfsHash = '';
    song.isListed = false;
    song.isMinted = false;
    song.salesCount = BigInt.fromI32(0);
    song.likeCount = BigInt.fromI32(0);
    song.commentCount = BigInt.fromI32(0);
    song.createdAt = event.block.timestamp;
  }

  song.tokenId = tokenId;
  song.owner = to;
  song.updatedAt = event.block.timestamp;

  let artist = Artist.load(song.artist);
  if (!artist) {
    artist = new Artist(song.artist);
    artist.wallet = song.artist;
    artist.name = 'Artist ' + song.artist.slice(0, 6);
    artist.totalTracks = BigInt.fromI32(0);
    artist.totalSalesCount = BigInt.fromI32(0);
    artist.totalVolume = BigInt.fromI32(0);
    artist.createdAt = event.block.timestamp;
    artist.updatedAt = event.block.timestamp;
    artist.save();
  }

  const isMint = from == ZERO_ADDRESS || from.toLowerCase() == ZERO_ADDRESS;
  const isBurn = to == ZERO_ADDRESS || to.toLowerCase() == ZERO_ADDRESS;

  if (isMint) {
    song.isMinted = true;

    const mintEventId = event.transaction.hash.toHex() + '-' + event.logIndex.toString();
    const mintEvent = new MintEvent(mintEventId);
    mintEvent.song = songId;
    mintEvent.artist = song.artist;
    mintEvent.minter = to;
    mintEvent.tokenId = tokenId;
    mintEvent.tokenUri = song.contentCid;
    mintEvent.txHash = event.transaction.hash.toHex();
    mintEvent.ledger = event.block.number;
    mintEvent.createdAt = event.block.timestamp;
    mintEvent.save();
  } else if (isBurn) {
    song.isListed = false;
  } else {
    song.isListed = false;
  }

  song.save();

  const transferEventId = event.transaction.hash.toHex() + '-' + event.logIndex.toString();
  const transferEvent = new TransferEvent(transferEventId);
  transferEvent.song = songId;
  transferEvent.tokenId = tokenId;
  transferEvent.from = from;
  transferEvent.to = to;
  transferEvent.txHash = event.transaction.hash.toHex();
  transferEvent.ledger = event.block.number;
  transferEvent.createdAt = event.block.timestamp;
  transferEvent.save();
}
