import 'reflect-metadata';

jest.mock('../../../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

jest.mock('../../JobQueueService', () => ({
  JobQueueService: { enqueue: jest.fn() },
}));

const mockPublish = jest.fn();
jest.mock('../../WebhookService', () => ({
  WebhookService: jest.fn().mockImplementation(() => ({ publish: mockPublish })),
}));

import AppDataSource from '../../../config/db';
import { AiGenerationService } from '../AiGenerationService';
import { AiGenerationRecord } from '../../../entities/AiGenerationRecord';
import { Song } from '../../../entities/Song';
import { JobQueueService } from '../../JobQueueService';
import { getAiProvider, resetAiProviderForTests } from '..';

const SONG_ID = 'song-1';
const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const RECORD_ID = 'record-1';

const mockRecordRepo = {
  create: jest.fn((entity) => entity),
  save: jest.fn((entity) => Promise.resolve({ id: RECORD_ID, ...entity })),
  findOneBy: jest.fn(),
};

const mockSongRepo = {
  findOneBy: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  resetAiProviderForTests();
  delete process.env.AI_FEATURE_COVER_ART_ENABLED;
  delete process.env.AI_FEATURE_DESCRIPTIONS_ENABLED;

  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
    if (entity === AiGenerationRecord) return mockRecordRepo;
    if (entity === Song) return mockSongRepo;
    return {};
  });
});

describe('AiGenerationService.requestGeneration', () => {
  it('rejects when the feature flag is disabled', async () => {
    const service = new AiGenerationService();

    await expect(service.requestGeneration('coverArt', SONG_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 400,
      code: 'AI_FEATURE_DISABLED',
    });
    expect(JobQueueService.enqueue).not.toHaveBeenCalled();
  });

  it('rejects for a song the caller does not own', async () => {
    process.env.AI_FEATURE_COVER_ART_ENABLED = 'true';
    mockSongRepo.findOneBy.mockResolvedValue({ id: SONG_ID, artistId: OTHER_USER_ID, title: 'X' });
    const service = new AiGenerationService();

    await expect(service.requestGeneration('coverArt', SONG_ID, USER_ID)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('creates a pending record and routes the job through JobQueueService', async () => {
    process.env.AI_FEATURE_DESCRIPTIONS_ENABLED = 'true';
    mockSongRepo.findOneBy.mockResolvedValue({ id: SONG_ID, artistId: USER_ID, title: 'X' });
    const service = new AiGenerationService();

    const record = await service.requestGeneration('descriptions', SONG_ID, USER_ID);

    expect(record.status).toBe('pending');
    expect(JobQueueService.enqueue).toHaveBeenCalledWith(
      'ai.generate_description',
      { recordId: RECORD_ID },
      { priority: 'low' },
    );
  });
});

describe('AiGenerationService.generate', () => {
  it('runs the configured provider and marks the record completed, then publishes a webhook', async () => {
    mockRecordRepo.findOneBy.mockResolvedValue({
      id: RECORD_ID,
      songId: SONG_ID,
      userId: USER_ID,
      feature: 'coverArt',
      status: 'pending',
    });
    mockSongRepo.findOneBy.mockResolvedValue({ id: SONG_ID, artistId: USER_ID, title: 'My Song' });
    const service = new AiGenerationService();

    await service.generate('coverArt', RECORD_ID);

    expect(mockRecordRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', provider: getAiProvider().name }),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      'ai.generation.completed',
      expect.objectContaining({ recordId: RECORD_ID, status: 'completed', feature: 'coverArt' }),
    );
  });

  it('throws when the song backing the record has been deleted', async () => {
    mockRecordRepo.findOneBy.mockResolvedValue({
      id: RECORD_ID,
      songId: SONG_ID,
      userId: USER_ID,
      feature: 'descriptions',
    });
    mockSongRepo.findOneBy.mockResolvedValue(null);
    const service = new AiGenerationService();

    await expect(service.generate('descriptions', RECORD_ID)).rejects.toThrow();
    expect(mockRecordRepo.save).not.toHaveBeenCalled();
  });
});

describe('AiGenerationService.markFailed', () => {
  it('marks the record failed and publishes a webhook event', async () => {
    mockRecordRepo.findOneBy.mockResolvedValue({
      id: RECORD_ID,
      songId: SONG_ID,
      userId: USER_ID,
      feature: 'coverArt',
      status: 'pending',
    });
    const service = new AiGenerationService();

    await service.markFailed(RECORD_ID, 'provider unavailable');

    expect(mockRecordRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorMessage: 'provider unavailable' }),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      'ai.generation.completed',
      expect.objectContaining({ status: 'failed', errorMessage: 'provider unavailable' }),
    );
  });
});
