import { AudioFingerprintService } from '../AudioFingerprintService';
import { Song } from '../../../entities/Song';

describe('AudioFingerprintService (Issue #272)', () => {
  let fingerprintService: AudioFingerprintService;
  let mockSongRepo: any;

  // Generate synthetic audio fixtures
  // Fixture A: 440Hz Tone (Original Track)
  const fixtureA = Buffer.alloc(4096);
  for (let i = 0; i < fixtureA.length; i++) {
    fixtureA[i] = Math.floor(128 + 120 * Math.sin((2 * Math.PI * 440 * i) / 44100));
  }

  // Fixture B: Near-Duplicate of Track A (same 440Hz tone with slight amplitude variations)
  const fixtureB_SimilarToA = Buffer.alloc(4096);
  for (let i = 0; i < fixtureB_SimilarToA.length; i++) {
    fixtureB_SimilarToA[i] = Math.floor(128 + 115 * Math.sin((2 * Math.PI * 440 * i) / 44100));
  }

  // Fixture C: Dissimilar Track 1 (3000Hz High Frequency Chime)
  const fixtureC_Dissimilar = Buffer.alloc(4096);
  for (let i = 0; i < fixtureC_Dissimilar.length; i++) {
    fixtureC_Dissimilar[i] = Math.floor(128 + 120 * Math.sin((2 * Math.PI * 3000 * i) / 44100));
  }

  // Fixture D: Dissimilar Track 2 (Low 80Hz Sub Bass)
  const fixtureD_Dissimilar = Buffer.alloc(4096);
  for (let i = 0; i < fixtureD_Dissimilar.length; i++) {
    fixtureD_Dissimilar[i] = Math.floor(128 + 120 * Math.sin((2 * Math.PI * 80 * i) / 44100));
  }

  beforeEach(() => {
    mockSongRepo = {
      findOneBy: jest.fn(),
      save: jest.fn().mockImplementation((song) => Promise.resolve(song)),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };

    fingerprintService = new AudioFingerprintService(mockSongRepo, 0.8);
  });

  describe('Fingerprint generation & comparison', () => {
    it('should generate deterministic fingerprints for audio buffers', async () => {
      const fp1 = await fingerprintService.generateFingerprint(fixtureA);
      const fp2 = await fingerprintService.generateFingerprint(fixtureA);

      expect(typeof fp1).toBe('string');
      expect(fp1.length).toBeGreaterThan(0);
      expect(fp1).toBe(fp2);
    });

    it('should detect high similarity between two similar fixtures (Fixture A and Fixture B)', async () => {
      const fpA = await fingerprintService.generateFingerprint(fixtureA);
      const fpB = await fingerprintService.generateFingerprint(fixtureB_SimilarToA);

      const similarity = fingerprintService.compareFingerprints(fpA, fpB);
      expect(similarity).toBeGreaterThanOrEqual(0.8);
    });

    it('should detect low similarity between two dissimilar fixtures (Fixture A/B and Fixture C/D)', async () => {
      const fpA = await fingerprintService.generateFingerprint(fixtureA);
      const fpC = await fingerprintService.generateFingerprint(fixtureC_Dissimilar);
      const fpD = await fingerprintService.generateFingerprint(fixtureD_Dissimilar);

      const simAC = fingerprintService.compareFingerprints(fpA, fpC);
      const simAD = fingerprintService.compareFingerprints(fpA, fpD);
      const simCD = fingerprintService.compareFingerprints(fpC, fpD);

      expect(simAC).toBeLessThan(0.6);
      expect(simAD).toBeLessThan(0.6);
      expect(simCD).toBeLessThan(0.6);
    });
  });

  describe('Duplicate detection & flagging policy', () => {
    it('should flag near-duplicate songs for review rather than auto-blocking', async () => {
      const existingSongId = 'existing-song-uuid-123';
      const fpExisting = await fingerprintService.generateFingerprint(fixtureA);

      // Mock repository containing existing song with fixture A fingerprint
      mockSongRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: existingSongId,
            title: 'Original Song',
            fingerprint: fpExisting,
          },
        ]),
      });

      const newSong: Partial<Song> = {
        id: 'new-song-uuid-456',
        title: 'Re-uploaded or Plagiarized Track',
        flagged: false,
        status: 'ready',
      };
      mockSongRepo.findOneBy.mockResolvedValue(newSong);

      // Process new upload with similar fixture B
      const result = await fingerprintService.processSongFingerprint(
        'new-song-uuid-456',
        fixtureB_SimilarToA,
      );

      // Verification of Acceptance Criteria:
      // 1. Fingerprint is stored on the song
      expect(result.song.fingerprint).toBeDefined();

      // 2. Near-duplicate is flagged for review
      expect(result.song.isNearDuplicate).toBe(true);
      expect(result.song.duplicateOfSongId).toBe(existingSongId);
      expect(result.song.flagged).toBe(true);
      expect(result.song.flagReason).toContain('Flagged for duplicate/plagiarism review');

      // 3. Upload is NOT auto-blocked or failed (status preserved)
      expect(result.song.status).toBe('ready');
      expect(mockSongRepo.save).toHaveBeenCalledWith(result.song);
    });

    it('should not flag dissimilar songs as duplicates', async () => {
      const existingSongId = 'existing-song-uuid-123';
      const fpExisting = await fingerprintService.generateFingerprint(fixtureA);

      mockSongRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: existingSongId,
            title: 'Original Song',
            fingerprint: fpExisting,
          },
        ]),
      });

      const cleanSong: Partial<Song> = {
        id: 'unique-song-uuid-789',
        title: 'Original Techno Track',
        flagged: false,
        status: 'ready',
      };
      mockSongRepo.findOneBy.mockResolvedValue(cleanSong);

      const result = await fingerprintService.processSongFingerprint(
        'unique-song-uuid-789',
        fixtureC_Dissimilar,
      );

      expect(result.song.isNearDuplicate).toBe(false);
      expect(result.song.duplicateOfSongId).toBeUndefined();
      expect(result.song.flagged).toBe(false);
      expect(mockSongRepo.save).toHaveBeenCalled();
    });
  });
});
