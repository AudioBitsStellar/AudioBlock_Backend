import 'reflect-metadata';

/**
 * Pre-save campaigns for upcoming releases (Issue #424).
 *
 * - Pre-save is recorded before release publish.
 * - Pre-saved releases auto-appear in the fan's library at publish time.
 */

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import AppDataSource from '../config/db';
import { PreSaveService } from '../services/PreSaveService';
import { ReleaseService } from '../services/ReleaseService';
import { ReleaseType } from '../entities/Release';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ARTIST_ID = '55555555-5555-4555-8555-555555555555';
const RELEASE_ID = '22222222-2222-4222-8222-222222222222';
const SONG_1 = '33333333-3333-4333-8333-333333333333';
const SONG_2 = '44444444-4444-4444-8444-444444444444';

function futureDate(): Date {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

function pastDate(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

describe('Pre-save campaigns (issue #424)', () => {
  let releases: any[];
  let preSaves: any[];
  let tracks: any[];
  let saves: any[];

  function releaseRepo(): any {
    return {
      findOneBy: jest.fn(async ({ id }: any) => releases.find((r) => r.id === id) ?? null),
      findOne: jest.fn(async ({ where }: any) => releases.find((r) => r.id === where?.id) ?? null),
      save: jest.fn(async (entity: any) => {
        if (Array.isArray(entity)) return entity;
        const idx = releases.findIndex((r) => r.id === entity.id);
        if (idx >= 0) releases[idx] = { ...releases[idx], ...entity };
        else releases.push(entity);
        return releases.find((r) => r.id === entity.id);
      }),
      create: jest.fn((v: any) => ({ id: RELEASE_ID, ...v })),
      find: jest.fn(async () => releases),
      findBy: jest.fn(async () => []),
    };
  }

  function preSaveRepo(): any {
    return {
      findOne: jest.fn(
        async ({ where }: any) =>
          preSaves.find((p) => p.userId === where?.userId && p.releaseId === where?.releaseId) ??
          null,
      ),
      find: jest.fn(async ({ where }: any) =>
        preSaves.filter((p) => !where?.releaseId || p.releaseId === where.releaseId),
      ),
      count: jest.fn(
        async ({ where }: any) =>
          preSaves.filter((p) => !where?.releaseId || p.releaseId === where.releaseId).length,
      ),
      create: jest.fn((v: any) => ({ id: 'pre-save-id', createdAt: new Date(), ...v })),
      save: jest.fn(async (entity: any) => {
        if (Array.isArray(entity)) {
          for (const e of entity) {
            const idx = preSaves.findIndex(
              (p) => p.userId === e.userId && p.releaseId === e.releaseId,
            );
            if (idx >= 0) preSaves[idx] = { ...preSaves[idx], ...e };
            else preSaves.push(e);
          }
          return entity;
        }
        const idx = preSaves.findIndex(
          (p) => p.userId === entity.userId && p.releaseId === entity.releaseId,
        );
        if (idx >= 0) preSaves[idx] = { ...preSaves[idx], ...entity };
        else preSaves.push(entity);
        return entity;
      }),
      remove: jest.fn(async (entity: any) => {
        preSaves = preSaves.filter(
          (p) => !(p.userId === entity.userId && p.releaseId === entity.releaseId),
        );
        return entity;
      }),
    };
  }

  function trackRepo(): any {
    return {
      find: jest.fn(async ({ where }: any) =>
        tracks.filter((t) => !where?.releaseId || t.releaseId === where.releaseId),
      ),
      save: jest.fn(async (v: any) => v),
      create: jest.fn((v: any) => v),
    };
  }

  function saveRepo(): any {
    return {
      findOne: jest.fn(
        async ({ where }: any) =>
          saves.find(
            (s) =>
              s.userId === where?.userId &&
              s.songId === where?.songId &&
              s.collection === where?.collection,
          ) ?? null,
      ),
      find: jest.fn(async () => saves),
      create: jest.fn((v: any) => ({ id: `save-${saves.length + 1}`, ...v })),
      save: jest.fn(async (entity: any) => {
        if (Array.isArray(entity)) return entity;
        saves.push(entity);
        return entity;
      }),
    };
  }

  function songRepo(): any {
    return {
      findOne: jest.fn(async () => null),
      findBy: jest.fn(async ({ id }: any) => {
        const ids = (id as any)?.value ?? [];
        return ids.map((songId: string) => ({ id: songId }));
      }),
    };
  }

  beforeEach(() => {
    releases = [
      {
        id: RELEASE_ID,
        title: 'Upcoming Album',
        artistId: ARTIST_ID,
        releaseDate: futureDate(),
        type: ReleaseType.ALBUM,
      },
    ];
    preSaves = [];
    tracks = [
      { id: 't1', releaseId: RELEASE_ID, songId: SONG_1, trackNumber: 1 },
      { id: 't2', releaseId: RELEASE_ID, songId: SONG_2, trackNumber: 2 },
    ];
    saves = [];

    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
      switch (entity?.name) {
        case 'Release':
          return releaseRepo();
        case 'ReleasePreSave':
          return preSaveRepo();
        case 'ReleaseTrack':
          return trackRepo();
        case 'UserSave':
          return saveRepo();
        case 'Song':
          return songRepo();
        default:
          return releaseRepo();
      }
    });
  });

  it('records a pre-save before release publish (idempotent)', async () => {
    const service = new PreSaveService();

    const first = await service.preSave(USER_ID, RELEASE_ID);
    expect(first.alreadyPreSaved).toBe(false);
    expect(first.preSave.userId).toBe(USER_ID);
    expect(first.preSave.releaseId).toBe(RELEASE_ID);

    const second = await service.preSave(USER_ID, RELEASE_ID);
    expect(second.alreadyPreSaved).toBe(true);
    expect(preSaves).toHaveLength(1);
  });

  it('rejects a pre-save once the release is already published', async () => {
    releases[0].releaseDate = pastDate();
    const service = new PreSaveService();

    await expect(service.preSave(USER_ID, RELEASE_ID)).rejects.toMatchObject({
      message: expect.stringMatching(/already published/i),
    });
    expect(preSaves).toHaveLength(0);
  });

  it('fulfilled pre-saves auto-appear in the fan library at publish time', async () => {
    const preSaveService = new PreSaveService();
    await preSaveService.preSave(USER_ID, RELEASE_ID);

    const releaseService = new ReleaseService();
    const { release, fulfilled, savesCreated } = await releaseService.publish(
      RELEASE_ID,
      ARTIST_ID,
    );

    expect(release.id).toBe(RELEASE_ID);
    expect(fulfilled).toBe(1);
    expect(savesCreated).toBe(2);

    const savedSongIds = saves.map((s) => s.songId).sort();
    expect(savedSongIds).toEqual([SONG_1, SONG_2].sort());
    expect(saves.every((s) => s.userId === USER_ID)).toBe(true);
    expect(preSaves[0].fulfilledAt).toBeInstanceOf(Date);
  });
});
