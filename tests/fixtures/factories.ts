export interface User {
  id: string;
  name: string;
  email: string;
  walletAddress: string;
  stellarPublicKey: string;
  balance: number;
  royaltyBalance: number;
}

export interface Song {
  id: string;
  title: string;
  ipfsHash: string;
  playCount: number;
  status: 'draft' | 'published' | 'ready';
  artistId: string;
}

export interface Album {
  id: string;
  title: string;
  songs: Song[];
  artistId: string;
}

export interface MarketplaceListing {
  id: string;
  song: Song;
  seller: User;
  owner: User;
  tokenId: number;
  priceInStroops: number;
  active: boolean;
  createdAt: string;
}

const randomId = (): string => `id_${Math.random().toString(36).slice(2, 12)}`;

const randomEmail = (): string => `user_${Math.random().toString(36).slice(2, 8)}@example.com`;

const randomTitle = (prefix: string): string =>
  `${prefix} ${Math.random().toString(36).slice(2, 8)}`;

export function userFactory(overrides: Partial<User> = {}): User {
  const id = overrides.id || randomId();
  const walletAddress = overrides.walletAddress || `wallet_${id}`;
  const stellarPublicKey =
    overrides.stellarPublicKey || `G${Math.random().toString(36).slice(2, 20).toUpperCase()}`;

  return {
    id,
    name: overrides.name || `Test User ${id}`,
    email: overrides.email || randomEmail(),
    walletAddress,
    stellarPublicKey,
    balance: overrides.balance ?? 0,
    royaltyBalance: overrides.royaltyBalance ?? 0,
    ...overrides,
  };
}

export function songFactory(overrides: Partial<Song> = {}): Song {
  const id = overrides.id || randomId();
  const title = overrides.title || randomTitle('Song');
  const artistId = overrides.artistId || randomId();

  return {
    id,
    title,
    ipfsHash: overrides.ipfsHash || `Qm${Math.random().toString(36).slice(2, 30)}`,
    playCount: overrides.playCount ?? 0,
    status: overrides.status ?? 'ready',
    artistId,
    ...overrides,
  };
}

export function albumFactory(overrides: Partial<Album> = {}): Album {
  const id = overrides.id || randomId();
  const title = overrides.title || randomTitle('Album');
  const songs =
    overrides.songs ?? createSongBatch(3, { artistId: overrides.artistId || randomId() });
  const artistId = overrides.artistId || songs[0]?.artistId || randomId();

  return {
    id,
    title,
    songs,
    artistId,
    ...overrides,
  };
}

export function createSongBatch(count: number, overrides: Partial<Song> = {}): Song[] {
  return Array.from({ length: count }, () => songFactory(overrides));
}

export function marketplaceListingFactory(
  overrides: Partial<MarketplaceListing> = {},
): MarketplaceListing {
  const id = overrides.id || randomId();
  const seller = overrides.seller || userFactory({ balance: 0 });
  const song = overrides.song || songFactory({ artistId: seller.id });
  const priceInStroops = overrides.priceInStroops ?? 10_000_000;
  const tokenId = overrides.tokenId ?? Math.floor(Math.random() * 10_000) + 1;

  return {
    id,
    song,
    seller,
    owner: overrides.owner || seller,
    tokenId,
    priceInStroops,
    active: overrides.active ?? true,
    createdAt: overrides.createdAt || new Date().toISOString(),
    ...overrides,
  };
}
