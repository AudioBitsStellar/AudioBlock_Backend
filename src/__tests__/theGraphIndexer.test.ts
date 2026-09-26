import fs from 'fs';
import path from 'path';
import { SubgraphQueryService } from '../services/SubgraphQueryService';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('The Graph Indexer - Entity Relationships & Mapping Handlers', () => {
  const schemaPath = path.join(__dirname, '../../subgraph/schema.graphql');
  const manifestPath = path.join(__dirname, '../../subgraph/subgraph.yaml');
  const songFacetAbiPath = path.join(__dirname, '../../subgraph/abis/SongFacet.json');
  const erc721FacetAbiPath = path.join(__dirname, '../../subgraph/abis/ERC721Facet.json');

  let schemaContent: string;
  let manifestContent: string;
  let songFacetAbiContent: string;
  let erc721FacetAbiContent: string;

  beforeAll(() => {
    schemaContent = fs.readFileSync(schemaPath, 'utf8');
    manifestContent = fs.readFileSync(manifestPath, 'utf8');
    songFacetAbiContent = fs.readFileSync(songFacetAbiPath, 'utf8');
    erc721FacetAbiContent = fs.readFileSync(erc721FacetAbiPath, 'utf8');
  });

  // =========================================================================
  // Issue #656: Entity Relationships (Artist -> Tracks -> Sales)
  // =========================================================================
  describe('Issue #656: Entity Relationships (Artist -> Tracks -> Sales)', () => {
    it('defines Artist entity with relationships to Tracks, Albums, and Sales', () => {
      expect(schemaContent).toContain('type Artist @entity');
      expect(schemaContent).toContain('tracks: [Song!]! @derivedFrom(field: "artist")');
      expect(schemaContent).toContain('albums: [Album!]! @derivedFrom(field: "artist")');
      expect(schemaContent).toContain('sales: [Sale!]! @derivedFrom(field: "artist")');
      expect(schemaContent).toContain('totalTracks: BigInt!');
      expect(schemaContent).toContain('totalSalesCount: BigInt!');
      expect(schemaContent).toContain('totalVolume: BigInt!');
    });

    it('defines Song (Track) entity with relationships to Artist and Sales', () => {
      expect(schemaContent).toContain('type Song @entity');
      expect(schemaContent).toContain('artist: Artist!');
      expect(schemaContent).toContain('album: Album');
      expect(schemaContent).toContain('sales: [Sale!]! @derivedFrom(field: "song")');
      expect(schemaContent).toContain('transfers: [TransferEvent!]! @derivedFrom(field: "song")');
      expect(schemaContent).toContain('mints: [MintEvent!]! @derivedFrom(field: "song")');
      expect(schemaContent).toContain('likes: [Like!]! @derivedFrom(field: "song")');
      expect(schemaContent).toContain('comments: [Comment!]! @derivedFrom(field: "song")');
      expect(schemaContent).toContain('salesCount: BigInt!');
      expect(schemaContent).toContain('likeCount: BigInt!');
      expect(schemaContent).toContain('commentCount: BigInt!');
    });

    it('defines Sale entity connecting Song (Track) and Artist', () => {
      expect(schemaContent).toContain('type Sale @entity');
      expect(schemaContent).toContain('song: Song!');
      expect(schemaContent).toContain('artist: Artist!');
      expect(schemaContent).toContain('seller: String!');
      expect(schemaContent).toContain('buyer: String!');
      expect(schemaContent).toContain('price: BigInt!');
      expect(schemaContent).toContain('tokenId: BigInt!');
      expect(schemaContent).toContain('txHash: String!');
      expect(schemaContent).toContain('ledger: BigInt!');
    });

    it('queries full Artist hierarchy (Artist -> Tracks -> Sales) via SubgraphQueryService', async () => {
      const mockArtistData = {
        artist: {
          id: '0xartist123',
          name: 'Crypto Beats',
          wallet: '0xartist123',
          totalTracks: '5',
          totalSalesCount: '12',
          totalVolume: '2500000000',
          tracks: [
            {
              id: 'track-1',
              title: 'Stellar Symphony',
              tokenId: '101',
              owner: '0xbuyer456',
              salesCount: '3',
              likeCount: '45',
              commentCount: '8',
              sales: [
                {
                  id: 'sale-1',
                  price: '500000000',
                  seller: '0xartist123',
                  buyer: '0xbuyer456',
                  createdAt: '1700000000',
                },
              ],
            },
          ],
          sales: [
            {
              id: 'sale-1',
              price: '500000000',
              seller: '0xartist123',
              buyer: '0xbuyer456',
              tokenId: '101',
              txHash: '0xtx123',
              createdAt: '1700000000',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce({
        data: { data: mockArtistData },
      });

      const service = new SubgraphQueryService('https://api.studio.thegraph.com/query/test');
      const result = await service.queryArtistHierarchy('0xartist123');

      expect(result.data).not.toBeNull();
      expect(result.data?.id).toBe('0xartist123');
      expect(result.data?.name).toBe('Crypto Beats');
      expect(result.data?.tracks).toHaveLength(1);
      expect(result.data?.tracks[0]?.title).toBe('Stellar Symphony');
      expect(result.data?.tracks[0]?.sales).toHaveLength(1);
      expect(result.data?.sales).toHaveLength(1);
      expect(result.error).toBeNull();
    });

    it('queries Sales list from subgraph via SubgraphQueryService', async () => {
      const mockSalesData = {
        sales: [
          {
            id: 'sale-1',
            price: '1000000',
            tokenId: '42',
            seller: '0xseller',
            buyer: '0xbuyer',
            txHash: '0xtx1',
            ledger: '12345',
            createdAt: '1700000000',
            song: { id: '42', title: 'Moonlight' },
            artist: { id: '0xartist', name: 'Luna' },
          },
        ],
      };

      mockedAxios.post.mockResolvedValueOnce({
        data: { data: mockSalesData },
      });

      const service = new SubgraphQueryService('https://api.studio.thegraph.com/query/test');
      const result = await service.querySales(10);

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.price).toBe('1000000');
      expect(result.data?.[0]?.song).toEqual({ id: '42', title: 'Moonlight' });
    });
  });

  // =========================================================================
  // Issue #655: Implement Mapping Handler for Transfer Event
  // =========================================================================
  describe('Issue #655: Implement Mapping Handler for Transfer Event', () => {
    it('declares Transfer event in ERC721Facet ABI and subgraph manifest', () => {
      const erc721Abi = JSON.parse(erc721FacetAbiContent);
      const transferEvent = erc721Abi.find(
        (item: { type: string; name: string }) =>
          item.type === 'event' && item.name === 'Transfer',
      );
      expect(transferEvent).toBeDefined();
      expect(transferEvent.inputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'from', type: 'address' }),
          expect.objectContaining({ name: 'to', type: 'address' }),
          expect.objectContaining({ name: 'tokenId', type: 'uint256' }),
        ]),
      );

      expect(manifestContent).toContain('name: ERC721Facet');
      expect(manifestContent).toContain('handler: handleTransfer');
      expect(manifestContent).toContain('file: ./src/mappings/erc721.ts');
    });

    it('defines TransferEvent entity in schema.graphql', () => {
      expect(schemaContent).toContain('type TransferEvent @entity');
      expect(schemaContent).toContain('song: Song');
      expect(schemaContent).toContain('tokenId: BigInt!');
      expect(schemaContent).toContain('from: String!');
      expect(schemaContent).toContain('to: String!');
      expect(schemaContent).toContain('txHash: String!');
      expect(schemaContent).toContain('ledger: BigInt!');
    });

    it('verifies mapping implementation in erc721.ts exists and handles transfers', () => {
      const erc721MappingPath = path.join(__dirname, '../../subgraph/src/mappings/erc721.ts');
      expect(fs.existsSync(erc721MappingPath)).toBe(true);

      const mappingCode = fs.readFileSync(erc721MappingPath, 'utf8');
      expect(mappingCode).toContain('export function handleTransfer(event: Transfer): void');
      expect(mappingCode).toContain('TransferEvent');
      expect(mappingCode).toContain('isMint');
      expect(mappingCode).toContain('song.owner = to');
      expect(mappingCode).toContain('ZERO_ADDRESS');
    });

    it('queries transfers via SubgraphQueryService', async () => {
      const mockTransfers = {
        transferEvents: [
          {
            id: 'tx-1-0',
            tokenId: '101',
            from: '0x0000000000000000000000000000000000000000',
            to: '0xuser1',
            txHash: '0xtx1',
            ledger: '1000',
            createdAt: '1700000000',
            song: { id: '101', title: 'Track #101' },
          },
        ],
      };

      mockedAxios.post.mockResolvedValueOnce({
        data: { data: mockTransfers },
      });

      const service = new SubgraphQueryService('https://api.studio.thegraph.com/query/test');
      const result = await service.queryTransfers(10);

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.tokenId).toBe('101');
      expect(result.data?.[0]?.to).toBe('0xuser1');
    });
  });

  // =========================================================================
  // Issue #654: Implement Mapping Handler for NFT Mint Event
  // =========================================================================
  describe('Issue #654: Implement Mapping Handler for NFT Mint Event', () => {
    it('defines MintEvent entity in schema.graphql', () => {
      expect(schemaContent).toContain('type MintEvent @entity');
      expect(schemaContent).toContain('song: Song!');
      expect(schemaContent).toContain('artist: Artist!');
      expect(schemaContent).toContain('minter: String!');
      expect(schemaContent).toContain('tokenId: BigInt!');
      expect(schemaContent).toContain('tokenUri: String');
      expect(schemaContent).toContain('txHash: String!');
      expect(schemaContent).toContain('ledger: BigInt!');
    });

    it('handles SongUploadedSuccessfully in AlbumFacet mapping', () => {
      const albumMappingPath = path.join(__dirname, '../../subgraph/src/mappings/album.ts');
      expect(fs.existsSync(albumMappingPath)).toBe(true);

      const mappingCode = fs.readFileSync(albumMappingPath, 'utf8');
      expect(mappingCode).toContain('handleSongUploadedSuccessfully');
      expect(mappingCode).toContain('MintEvent');
      expect(mappingCode).toContain('song.isMinted = true');
      expect(mappingCode).toContain('artist.totalTracks = artist.totalTracks.plus');
    });

    it('queries NFT mints via SubgraphQueryService', async () => {
      const mockMints = {
        mintEvents: [
          {
            id: 'tx-2-0',
            tokenId: '55',
            minter: '0xartist1',
            tokenUri: 'ipfs://QmHash123',
            txHash: '0xtx2',
            ledger: '1050',
            createdAt: '1700000100',
            song: { id: '55', title: 'Galactic Groove' },
            artist: { id: '0xartist1', name: 'DJ Stellar' },
          },
        ],
      };

      mockedAxios.post.mockResolvedValueOnce({
        data: { data: mockMints },
      });

      const service = new SubgraphQueryService('https://api.studio.thegraph.com/query/test');
      const result = await service.queryMints(10);

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.tokenId).toBe('55');
      expect(result.data?.[0]?.tokenUri).toBe('ipfs://QmHash123');
      expect(result.data?.[0]?.minter).toBe('0xartist1');
    });
  });

  // =========================================================================
  // Issue #653: Implement Mapping Handler for Like/Comment Event
  // =========================================================================
  describe('Issue #653: Implement Mapping Handler for Like/Comment Event', () => {
    it('defines Like, LikeEvent, Comment, and CommentEvent entities in schema.graphql', () => {
      expect(schemaContent).toContain('type Like @entity');
      expect(schemaContent).toContain('type LikeEvent @entity');
      expect(schemaContent).toContain('type Comment @entity');
      expect(schemaContent).toContain('type CommentEvent @entity');
      expect(schemaContent).toContain('song: Song!');
      expect(schemaContent).toContain('author: String!');
      expect(schemaContent).toContain('content: String!');
    });

    it('defines SongLiked, SongUnliked, CommentAdded, CommentRemoved events in SongFacet ABI', () => {
      const songAbi = JSON.parse(songFacetAbiContent);
      const eventNames = songAbi.map((item: { name: string }) => item.name);

      expect(eventNames).toContain('SongLiked');
      expect(eventNames).toContain('SongUnliked');
      expect(eventNames).toContain('CommentAdded');
      expect(eventNames).toContain('CommentRemoved');
    });

    it('binds engagement handlers in subgraph manifest', () => {
      expect(manifestContent).toContain('handler: handleSongLiked');
      expect(manifestContent).toContain('handler: handleSongUnliked');
      expect(manifestContent).toContain('handler: handleCommentAdded');
      expect(manifestContent).toContain('handler: handleCommentRemoved');
    });

    it('verifies engagement handler implementations in song.ts', () => {
      const songMappingPath = path.join(__dirname, '../../subgraph/src/mappings/song.ts');
      const mappingCode = fs.readFileSync(songMappingPath, 'utf8');

      expect(mappingCode).toContain('export function handleSongLiked');
      expect(mappingCode).toContain('song.likeCount = song.likeCount.plus');
      expect(mappingCode).toContain('export function handleSongUnliked');
      expect(mappingCode).toContain('song.likeCount = song.likeCount.minus');
      expect(mappingCode).toContain('export function handleCommentAdded');
      expect(mappingCode).toContain('song.commentCount = song.commentCount.plus');
      expect(mappingCode).toContain('export function handleCommentRemoved');
      expect(mappingCode).toContain('song.commentCount = song.commentCount.minus');
    });

    it('queries track engagement (likes & comments) via SubgraphQueryService', async () => {
      const mockEngagement = {
        song: {
          likeCount: '42',
          commentCount: '3',
          likes: [
            {
              id: 'song-1-0xuser1',
              user: '0xuser1',
              createdAt: '1700000000',
              txHash: '0xtx1',
            },
          ],
          comments: [
            {
              id: 'cmt-1',
              author: '0xuser2',
              content: 'Incredible track!',
              createdAt: '1700000010',
              txHash: '0xtx2',
            },
          ],
        },
      };

      mockedAxios.post.mockResolvedValueOnce({
        data: { data: mockEngagement },
      });

      const service = new SubgraphQueryService('https://api.studio.thegraph.com/query/test');
      const result = await service.queryTrackEngagement('song-1');

      expect(result.data).not.toBeNull();
      expect(result.data?.likeCount).toBe('42');
      expect(result.data?.commentCount).toBe('3');
      expect(result.data?.likes).toHaveLength(1);
      expect(result.data?.comments).toHaveLength(1);
      expect(result.data?.comments[0]?.content).toBe('Incredible track!');
    });
  });
});
