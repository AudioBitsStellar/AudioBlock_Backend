import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

import AppDataSource from '../config/db';
import { PlaylistService } from '../services/PlaylistService';
import { Playlist } from '../entities/Playlist';
import { PlaylistSong } from '../entities/PlaylistSong';
import { PlaylistCollaborator, PlaylistCollaboratorRole } from '../entities/PlaylistCollaborator';
import { Song } from '../entities/Song';

const mockPlaylistRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findAndCount: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  delete: jest.fn(),
};
const mockPlaylistSongRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
  maximum: jest.fn(),
};
const mockCollaboratorRepo = {
  findOneBy: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
};
const mockSongRepo = {
  findOneBy: jest.fn(),
  createQueryBuilder: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: unknown) => {
    if (entity === Playlist) return mockPlaylistRepo;
    if (entity === PlaylistSong) return mockPlaylistSongRepo;
    if (entity === PlaylistCollaborator) return mockCollaboratorRepo;
    if (entity === Song) return mockSongRepo;
    throw new Error(`Unexpected entity: ${(entity as { name?: string })?.name}`);
  });
});

function makeSvc(): PlaylistService {
  return new PlaylistService();
}

const ownedPlaylist = (overrides: Partial<Playlist> = {}): Playlist =>
  ({
    id: 'pl-1',
    userId: 'user-1',
    name: 'My Playlist',
    description: '',
    isPublic: true,
    coverImageUrl: '',
    isRuleBased: false,
    rule: null,
    songs: [],
    ...overrides,
  }) as Playlist;

describe('PlaylistService.create', () => {
  it('creates a playlist with a trimmed name', async () => {
    mockPlaylistRepo.create.mockImplementation((input: unknown) => input);
    mockPlaylistRepo.save.mockImplementation(async (p: Playlist) => p);

    const svc = makeSvc();
    const result = await svc.create('user-1', { name: '  Road Trip  ', description: 'driving' });

    expect(mockPlaylistRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', name: 'Road Trip', isPublic: true }),
    );
    expect(result.name).toBe('Road Trip');
  });

  it('rejects an empty playlist name', async () => {
    const svc = makeSvc();
    await expect(svc.create('user-1', { name: '   ' })).rejects.toThrow(
      'Playlist name is required',
    );
    expect(mockPlaylistRepo.save).not.toHaveBeenCalled();
  });
});

describe('PlaylistService.listForUser', () => {
  it('returns paginated playlists for the user', async () => {
    const playlists = [ownedPlaylist({ id: 'pl-a' }), ownedPlaylist({ id: 'pl-b' })];
    mockPlaylistRepo.findAndCount.mockResolvedValue([playlists, 2]);

    const svc = makeSvc();
    const result = await svc.listForUser('user-1', 1, 20);

    expect(mockPlaylistRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' }, skip: 0, take: 20 }),
    );
    expect(result.data).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
    expect(result.pagination.totalPages).toBe(1);
  });
});

describe('PlaylistService.getById', () => {
  it('returns a public playlist to any viewer', async () => {
    const playlist = ownedPlaylist({
      songs: [
        { id: 'ps-2', songId: 'song-2', position: 1 },
        { id: 'ps-1', songId: 'song-1', position: 0 },
      ] as unknown as PlaylistSong[],
    });
    mockPlaylistRepo.findOne.mockResolvedValue(playlist);

    const svc = makeSvc();
    const result = await svc.getById('pl-1', 'other-user');

    expect(mockPlaylistRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        relations: { songs: { song: true }, collaborators: true },
        order: { songs: { position: 'ASC' } },
      }),
    );
    expect(result.id).toBe('pl-1');
  });

  it('throws 404 when the playlist does not exist', async () => {
    mockPlaylistRepo.findOne.mockResolvedValue(null);

    const svc = makeSvc();
    await expect(svc.getById('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('denies access to a private playlist for non-owners', async () => {
    mockPlaylistRepo.findOne.mockResolvedValue(ownedPlaylist({ isPublic: false }));

    const svc = makeSvc();
    await expect(svc.getById('pl-1', 'other-user')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows the owner to read their own private playlist', async () => {
    mockPlaylistRepo.findOne.mockResolvedValue(ownedPlaylist({ isPublic: false }));

    const svc = makeSvc();
    await expect(svc.getById('pl-1', 'user-1')).resolves.toMatchObject({ id: 'pl-1' });
  });
});

describe('PlaylistService.update / remove', () => {
  it('updates playlist metadata as the owner', async () => {
    const playlist = ownedPlaylist();
    mockPlaylistRepo.findOneBy.mockResolvedValue(playlist);
    mockPlaylistRepo.save.mockImplementation(async (p: Playlist) => p);

    const svc = makeSvc();
    const result = await svc.update('pl-1', 'user-1', { name: 'Renamed', isPublic: false });

    expect(result.name).toBe('Renamed');
    expect(result.isPublic).toBe(false);
  });

  it('rejects updates from a non-owner', async () => {
    mockPlaylistRepo.findOneBy.mockResolvedValue(ownedPlaylist());

    const svc = makeSvc();
    await expect(svc.update('pl-1', 'intruder', { name: 'Hacked' })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockPlaylistRepo.save).not.toHaveBeenCalled();
  });

  it('deletes the playlist when called by the owner', async () => {
    mockPlaylistRepo.findOneBy.mockResolvedValue(ownedPlaylist());
    mockPlaylistRepo.delete.mockResolvedValue({ affected: 1 });

    const svc = makeSvc();
    await svc.remove('pl-1', 'user-1');

    expect(mockPlaylistRepo.delete).toHaveBeenCalledWith({ id: 'pl-1' });
  });

  it('throws 404 when removing a missing playlist', async () => {
    mockPlaylistRepo.findOneBy.mockResolvedValue(null);

    const svc = makeSvc();
    await expect(svc.remove('missing', 'user-1')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('PlaylistService.addSong / removeSong', () => {
  it('appends a song at the next position', async () => {
    mockPlaylistRepo.findOneBy.mockResolvedValue(ownedPlaylist());
    mockSongRepo.findOneBy.mockResolvedValue({ id: 'song-1' });
    mockPlaylistSongRepo.findOne.mockResolvedValue(null);
    mockPlaylistSongRepo.maximum.mockResolvedValue(3);
    mockPlaylistSongRepo.create.mockImplementation((input: unknown) => input);
    mockPlaylistSongRepo.save.mockImplementation(async (e: PlaylistSong) => e);

    const svc = makeSvc();
    const entry = await svc.addSong('pl-1', 'user-1', 'song-1');

    expect(mockPlaylistSongRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ playlistId: 'pl-1', songId: 'song-1', position: 4 }),
    );
    expect(entry.position).toBe(4);
  });

  it('is idempotent when the song is already in the playlist', async () => {
    mockPlaylistRepo.findOneBy.mockResolvedValue(ownedPlaylist());
    mockSongRepo.findOneBy.mockResolvedValue({ id: 'song-1' });
    mockPlaylistSongRepo.findOne.mockResolvedValue({ id: 'ps-1', songId: 'song-1' });

    const svc = makeSvc();
    const entry = await svc.addSong('pl-1', 'user-1', 'song-1');

    expect(entry.id).toBe('ps-1');
    expect(mockPlaylistSongRepo.save).not.toHaveBeenCalled();
  });

  it('throws 404 when adding a song that does not exist', async () => {
    mockPlaylistRepo.findOneBy.mockResolvedValue(ownedPlaylist());
    mockSongRepo.findOneBy.mockResolvedValue(null);

    const svc = makeSvc();
    await expect(svc.addSong('pl-1', 'user-1', 'ghost')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('removes a song from the playlist', async () => {
    mockPlaylistRepo.findOneBy.mockResolvedValue(ownedPlaylist());
    mockPlaylistSongRepo.delete.mockResolvedValue({ affected: 1 });

    const svc = makeSvc();
    await svc.removeSong('pl-1', 'user-1', 'song-1');

    expect(mockPlaylistSongRepo.delete).toHaveBeenCalledWith({
      playlistId: 'pl-1',
      songId: 'song-1',
    });
  });

  it('throws 404 when removing a song that is not in the playlist', async () => {
    mockPlaylistRepo.findOneBy.mockResolvedValue(ownedPlaylist());
    mockPlaylistSongRepo.delete.mockResolvedValue({ affected: 0 });

    const svc = makeSvc();
    await expect(svc.removeSong('pl-1', 'user-1', 'song-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('PlaylistService.reorder', () => {
  it('reassigns positions in the requested order', async () => {
    mockPlaylistRepo.findOneBy.mockResolvedValue(ownedPlaylist());
    const entries = [
      { id: 'ps-1', playlistId: 'pl-1', songId: 'song-1', position: 0 },
      { id: 'ps-2', playlistId: 'pl-1', songId: 'song-2', position: 1 },
      { id: 'ps-3', playlistId: 'pl-1', songId: 'song-3', position: 2 },
    ];
    mockPlaylistSongRepo.find.mockResolvedValue(entries);
    mockPlaylistSongRepo.save.mockImplementation(async (saved: PlaylistSong[]) => saved);
    mockPlaylistRepo.findOne.mockResolvedValue(
      ownedPlaylist({ songs: [] as unknown as PlaylistSong[] }),
    );

    const svc = makeSvc();
    await svc.reorder('pl-1', 'user-1', ['song-3', 'song-1', 'song-2']);

    const saved = mockPlaylistSongRepo.save.mock.calls[0][0] as PlaylistSong[];
    expect(saved.map((e) => e.songId)).toEqual(['song-3', 'song-1', 'song-2']);
    expect(saved.map((e) => e.position)).toEqual([0, 1, 2]);
  });

  it('rejects reorder lists containing songs not in the playlist', async () => {
    mockPlaylistRepo.findOneBy.mockResolvedValue(ownedPlaylist());
    mockPlaylistSongRepo.find.mockResolvedValue([
      { id: 'ps-1', playlistId: 'pl-1', songId: 'song-1', position: 0 },
    ]);

    const svc = makeSvc();
    await expect(svc.reorder('pl-1', 'user-1', ['song-1', 'ghost'])).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('PlaylistService collaborative editing (Issue #406)', () => {
  it('allows the owner to invite a collaborator', async () => {
    mockPlaylistRepo.findOneBy.mockResolvedValue(ownedPlaylist());
    mockCollaboratorRepo.findOneBy.mockResolvedValue(null);
    mockCollaboratorRepo.create.mockImplementation((input: unknown) => input);
    mockCollaboratorRepo.save.mockImplementation(async (c: PlaylistCollaborator) => c);

    const svc = makeSvc();
    const result = await svc.addCollaborator('pl-1', 'user-1', {
      userId: 'user-2',
      role: PlaylistCollaboratorRole.EDITOR,
    });

    expect(result.userId).toBe('user-2');
    expect(result.role).toBe(PlaylistCollaboratorRole.EDITOR);
  });

  it('rejects an invite from a non-owner', async () => {
    mockPlaylistRepo.findOneBy.mockResolvedValue(ownedPlaylist());

    const svc = makeSvc();
    await expect(
      svc.addCollaborator('pl-1', 'intruder', {
        userId: 'user-2',
        role: PlaylistCollaboratorRole.EDITOR,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockCollaboratorRepo.save).not.toHaveBeenCalled();
  });

  it('lets an editor collaborator add a song', async () => {
    const playlist = ownedPlaylist({ userId: 'user-1' });
    mockPlaylistRepo.findOneBy.mockResolvedValue(playlist);
    mockCollaboratorRepo.findOneBy.mockResolvedValue({
      id: 'pc-1',
      playlistId: 'pl-1',
      userId: 'user-2',
      role: 'editor',
    });
    mockSongRepo.findOneBy.mockResolvedValue({ id: 'song-1' });
    mockPlaylistSongRepo.findOne.mockResolvedValue(null);
    mockPlaylistSongRepo.maximum.mockResolvedValue(0);
    mockPlaylistSongRepo.create.mockImplementation((input: unknown) => input);
    mockPlaylistSongRepo.save.mockImplementation(async (e: PlaylistSong) => e);

    const svc = makeSvc();
    const entry = await svc.addSong('pl-1', 'user-2', 'song-1');

    expect(entry.playlistId).toBe('pl-1');
    expect(entry.songId).toBe('song-1');
  });

  it('rejects an edit from a user who is not a collaborator (unauthorized)', async () => {
    const playlist = ownedPlaylist({ userId: 'user-1' });
    mockPlaylistRepo.findOneBy.mockResolvedValue(playlist);
    mockCollaboratorRepo.findOneBy.mockResolvedValue(null);

    const svc = makeSvc();
    await expect(svc.addSong('pl-1', 'stranger', 'song-1')).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockPlaylistSongRepo.save).not.toHaveBeenCalled();
  });

  it('rejects an edit from a viewer collaborator (no edit permission)', async () => {
    const playlist = ownedPlaylist({ userId: 'user-1' });
    mockPlaylistRepo.findOneBy.mockResolvedValue(playlist);
    mockCollaboratorRepo.findOneBy.mockImplementation(
      (query: { playlistId: string; userId: string; role?: string }) =>
        query.role === 'editor'
          ? null
          : { id: 'pc-1', playlistId: 'pl-1', userId: 'user-2', role: 'viewer' },
    );

    const svc = makeSvc();
    await expect(svc.addSong('pl-1', 'user-2', 'song-1')).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe('PlaylistService rule-based playlists (Issue #407)', () => {
  it('rejects a rule-based playlist with no criteria', async () => {
    const svc = makeSvc();
    await expect(
      svc.create('user-1', { name: 'Empty rule', isRuleBased: true, rule: {} }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPlaylistRepo.save).not.toHaveBeenCalled();
  });

  it('creates a rule-based playlist with valid criteria', async () => {
    mockPlaylistRepo.create.mockImplementation((input: unknown) => input);
    mockPlaylistRepo.save.mockImplementation(async (p: Playlist) => p);

    const rule = { tags: ['lo-fi'], genres: ['chill'], savedWithinDays: 30 };
    const svc = makeSvc();
    const result = await svc.create('user-1', { name: 'Smart', isRuleBased: true, rule });

    expect(mockPlaylistRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ isRuleBased: true, rule }),
    );
    expect(result.isRuleBased).toBe(true);
  });

  it('rejects manually adding a song to a rule-based playlist', async () => {
    mockPlaylistRepo.findOneBy.mockResolvedValue(ownedPlaylist({ isRuleBased: true }));

    const svc = makeSvc();
    await expect(svc.addSong('pl-1', 'user-1', 'song-1')).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('resolves matching songs at read time for a rule-based playlist', async () => {
    const playlist = ownedPlaylist({
      isRuleBased: true,
      rule: { tags: ['lo-fi'], savedWithinDays: 30 },
    });
    mockPlaylistRepo.findOne.mockResolvedValue(playlist);
    mockCollaboratorRepo.findOneBy.mockResolvedValue(null);

    const getMany = jest.fn().mockResolvedValue([
      { id: 'song-a', createdAt: new Date(), status: 'ready', flagged: false },
      { id: 'song-b', createdAt: new Date(), status: 'ready', flagged: false },
    ]);
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getMany,
    };
    mockSongRepo.createQueryBuilder.mockReturnValue(qb);
    mockPlaylistSongRepo.create.mockImplementation((input: unknown) => input);

    const svc = makeSvc();
    const result = await svc.getById('pl-1', 'user-1');

    expect(getMany).toHaveBeenCalled();
    expect(result.songs).toHaveLength(2);
    expect(result.songs[0].songId).toBe('song-a');
  });
});
