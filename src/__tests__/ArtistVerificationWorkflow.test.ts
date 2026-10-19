import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

jest.mock('../config/s3', () => ({
  s3: { upload: jest.fn() },
}));

import AppDataSource from '../config/db';
import { ArtistProfileService } from '../services/ArtistProfileService';
import { ArtistVerification, VerificationStatus } from '../entities/ArtistVerification';
import { User, UserRole } from '../entities/User';
import { UserFollow } from '../entities/UserFollow';
import { Song } from '../entities/Song';

const mockVerificationRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
};

const mockUserRepo = {
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  update: jest.fn(),
};

const mockFollowRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  count: jest.fn(),
  insert: jest.fn(),
  delete: jest.fn(),
};

const mockSongRepo = {
  findAndCount: jest.fn(),
};

const userId = '11111111-1111-4111-8111-111111111111';
const adminId = '22222222-2222-4222-8222-222222222222';
const verificationId = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
    if (entity === ArtistVerification) return mockVerificationRepo;
    if (entity === User) return mockUserRepo;
    if (entity === UserFollow) return mockFollowRepo;
    if (entity === Song) return mockSongRepo;
    return mockVerificationRepo;
  });

  mockUserRepo.findOne.mockResolvedValue({
    id: userId,
    username: 'testuser',
    role: UserRole.ARTIST,
  });
  mockUserRepo.findOneBy.mockResolvedValue({
    id: userId,
    username: 'testuser',
    role: UserRole.ARTIST,
  });
  mockUserRepo.update.mockResolvedValue({ affected: 1 });
  mockVerificationRepo.findOne.mockResolvedValue(null);
});

describe('Artist Verification Badge Workflow (Issue #92, #426)', () => {
  function makeSvc(): ArtistProfileService {
    return new ArtistProfileService();
  }

  describe('1. Artist Application Flow (applyForVerification)', () => {
    it('submits a new pending verification application', async () => {
      mockVerificationRepo.findOne.mockResolvedValue(null);
      mockVerificationRepo.create.mockImplementation((input: unknown) => ({
        id: verificationId,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(input as object),
      }));
      mockVerificationRepo.save.mockImplementation(async (v: unknown) => v);

      const svc = makeSvc();
      const result = await svc.applyForVerification(userId, {
        displayNameProof: 'Official DJ Stellar',
        socialLinks: ['https://x.com/djstellar'],
        musicLinks: ['https://open.spotify.com/artist/123'],
        notes: 'Verified on Spotify',
      });

      expect(mockVerificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          status: VerificationStatus.PENDING,
          displayNameProof: 'Official DJ Stellar',
          socialLinks: ['https://x.com/djstellar'],
          musicLinks: ['https://open.spotify.com/artist/123'],
          notes: 'Verified on Spotify',
        }),
      );
      expect(result.status).toBe(VerificationStatus.PENDING);
      expect(result.rejectionReason).toBeUndefined();
    });

    it('updates existing pending application when re-submitting before review', async () => {
      const existingPending = {
        id: verificationId,
        userId,
        status: VerificationStatus.PENDING,
        displayNameProof: 'Old Name',
        socialLinks: ['https://x.com/old'],
        musicLinks: ['https://spotify.com/old'],
        notes: 'Old notes',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockVerificationRepo.findOne
        .mockResolvedValueOnce(null) // no approved row
        .mockResolvedValueOnce(existingPending); // pending row found
      mockVerificationRepo.save.mockImplementation(async (v: unknown) => v);

      const svc = makeSvc();
      const result = await svc.applyForVerification(userId, {
        displayNameProof: 'Updated Name',
        socialLinks: ['https://x.com/new'],
        musicLinks: ['https://spotify.com/new'],
        notes: 'Updated notes',
      });

      expect(existingPending.displayNameProof).toBe('Updated Name');
      expect(mockVerificationRepo.save).toHaveBeenCalledWith(existingPending);
      expect(result.displayNameProof).toBe('Updated Name');
    });

    it('rejects application if account is already verified', async () => {
      mockVerificationRepo.findOne.mockResolvedValueOnce({
        id: 'approved-id',
        userId,
        status: VerificationStatus.APPROVED,
      });

      const svc = makeSvc();
      await expect(
        svc.applyForVerification(userId, {
          displayNameProof: 'Another Application',
          socialLinks: ['https://x.com/test'],
          musicLinks: ['https://spotify.com/test'],
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: 'This account is already verified',
      });
    });

    it('rejects invalid or non-http URLs in links', async () => {
      const svc = makeSvc();
      await expect(
        svc.applyForVerification(userId, {
          displayNameProof: 'DJ Bad Url',
          socialLinks: ['javascript:alert(1)'],
          musicLinks: ['https://spotify.com/test'],
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
      });
    });
  });

  describe('2. Artist Views Verification Status (getMyVerification & getVerificationBadge)', () => {
    it('returns null for artist who never applied', async () => {
      mockVerificationRepo.findOne.mockResolvedValue(null);

      const svc = makeSvc();
      const myVerification = await svc.getMyVerification(userId);
      const badge = await svc.getVerificationBadge(userId);

      expect(myVerification).toBeNull();
      expect(badge.verified).toBe(false);
    });

    it('shows pending status with no visible badge flag while waiting for review', async () => {
      mockVerificationRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.status === VerificationStatus.APPROVED) {
          return null;
        }
        return {
          id: verificationId,
          userId,
          status: VerificationStatus.PENDING,
          displayNameProof: 'DJ Waiting',
          socialLinks: ['https://x.com/waiting'],
          musicLinks: ['https://spotify.com/waiting'],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      const svc = makeSvc();
      const myVerification = await svc.getMyVerification(userId);
      const badge = await svc.getVerificationBadge(userId);

      expect(myVerification?.status).toBe(VerificationStatus.PENDING);
      expect(badge.verified).toBe(false);
      expect(badge.status).toBe(VerificationStatus.PENDING);
    });
  });

  describe('3. Admin Decision Flow — Approval (approveVerification)', () => {
    it('approves a pending application, sets badge flag, and updates User record', async () => {
      const pending = {
        id: verificationId,
        userId,
        status: VerificationStatus.PENDING,
        displayNameProof: 'DJ Star',
        socialLinks: ['https://x.com/star'],
        musicLinks: ['https://spotify.com/star'],
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockVerificationRepo.findOne.mockResolvedValue(pending);
      mockVerificationRepo.save.mockImplementation(async (v: unknown) => v);
      mockUserRepo.update.mockResolvedValue({ affected: 1 });

      const svc = makeSvc();
      const approved = await svc.approveVerification(verificationId, adminId);

      expect(approved.status).toBe(VerificationStatus.APPROVED);
      expect(approved.reviewedBy).toBe(adminId);
      expect(approved.reviewedAt).toBeInstanceOf(Date);
      expect(approved.rejectionReason).toBeNull();
      expect(mockUserRepo.update).toHaveBeenCalledWith({ id: userId }, { isVerified: true });

      // Now resolving the badge returns verified: true
      mockVerificationRepo.findOne.mockResolvedValue({
        id: verificationId,
        userId,
        status: VerificationStatus.APPROVED,
        reviewedAt: approved.reviewedAt,
      });

      const badge = await svc.getVerificationBadge(userId);
      expect(badge.verified).toBe(true);
      expect(badge.status).toBe(VerificationStatus.APPROVED);
      expect(badge.verifiedAt).toBeDefined();
    });

    it('throws 409 conflict when trying to approve an already decided application', async () => {
      mockVerificationRepo.findOne.mockResolvedValue({
        id: verificationId,
        userId,
        status: VerificationStatus.APPROVED,
      });

      const svc = makeSvc();
      await expect(svc.approveVerification(verificationId, adminId)).rejects.toMatchObject({
        statusCode: 409,
        message: 'Application has already been approved',
      });
    });
  });

  describe('4. Admin Decision Flow — Rejection with Reason (rejectVerification)', () => {
    it('rejects a pending application with a required reason', async () => {
      const pending = {
        id: verificationId,
        userId,
        status: VerificationStatus.PENDING,
        displayNameProof: 'DJ Wannabe',
        socialLinks: ['https://x.com/fake'],
        musicLinks: ['https://spotify.com/fake'],
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockVerificationRepo.findOne
        .mockResolvedValueOnce(pending) // loadPendingVerification
        .mockResolvedValueOnce(null); // no other approved row
      mockVerificationRepo.save.mockImplementation(async (v: unknown) => v);
      mockUserRepo.update.mockResolvedValue({ affected: 1 });

      const svc = makeSvc();
      const rejected = await svc.rejectVerification(
        verificationId,
        adminId,
        'Social media profiles could not be linked to the provided artist name',
      );

      expect(rejected.status).toBe(VerificationStatus.REJECTED);
      expect(rejected.reviewedBy).toBe(adminId);
      expect(rejected.reviewedAt).toBeInstanceOf(Date);
      expect(rejected.rejectionReason).toBe(
        'Social media profiles could not be linked to the provided artist name',
      );
      expect(mockUserRepo.update).toHaveBeenCalledWith({ id: userId }, { isVerified: false });
    });

    it('requires a non-empty reason when rejecting an application', async () => {
      mockVerificationRepo.findOne.mockResolvedValue({
        id: verificationId,
        userId,
        status: VerificationStatus.PENDING,
      });

      const svc = makeSvc();
      await expect(svc.rejectVerification(verificationId, adminId, '   ')).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('allows rejected artist to view rejection reason and re-apply later', async () => {
      // 1. Artist views rejection reason
      mockVerificationRepo.findOne.mockResolvedValueOnce({
        id: verificationId,
        userId,
        status: VerificationStatus.REJECTED,
        rejectionReason: 'Music links are inaccessible',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const svc = makeSvc();
      const statusView = await svc.getMyVerification(userId);

      expect(statusView?.status).toBe(VerificationStatus.REJECTED);
      expect(statusView?.rejectionReason).toBe('Music links are inaccessible');

      // 2. Artist re-applies
      mockVerificationRepo.findOne
        .mockResolvedValueOnce(null) // no approved row
        .mockResolvedValueOnce(null); // no pending row (previous is rejected)
      mockVerificationRepo.create.mockImplementation((input: unknown) => ({
        id: 'new-app-id',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(input as object),
      }));
      mockVerificationRepo.save.mockImplementation(async (v: unknown) => v);

      const newApp = await svc.applyForVerification(userId, {
        displayNameProof: 'DJ Stellar Refined',
        socialLinks: ['https://x.com/stellar-real'],
        musicLinks: ['https://open.spotify.com/artist/valid'],
      });

      expect(newApp.status).toBe(VerificationStatus.PENDING);
    });
  });
});
