import { Repository, In } from 'typeorm';
import AppDataSource from '../config/db';
import { User, UserRole } from '../entities/User';
import { UserFollow } from '../entities/UserFollow';
import { Song } from '../entities/Song';
import fs from 'fs';
import { s3 } from '../config/s3';
import { UpdateArtistProfileDTO } from '../dtos/UpdateArtistProfileDTO';
import path from 'path';
import {
  ArtistVerification,
  VerificationStatus,
  VERIFICATION_LINK_MAX_LENGTH,
  VERIFICATION_MAX_LINKS,
  VERIFICATION_REASON_MAX_LENGTH,
} from '../entities/ArtistVerification';
import { AppError } from '../errors/AppError';
import { ERROR_MESSAGES } from '../config/constants';
import { validateStringLength, validateUUID } from '../validators/ServiceValidator';

/** Default page size for the admin verification queue. */
const DEFAULT_VERIFICATION_LIMIT = 20;

/** Hard cap on the admin queue page size. */
const MAX_VERIFICATION_LIMIT = 100;

/** Fields required on a verification application. */
export interface VerificationApplicationInput {
  displayNameProof: string;
  socialLinks: string[];
  musicLinks: string[];
  notes?: string;
}

/** A verification application as returned to clients. */
export interface VerificationView {
  id: string;
  userId: string;
  status: VerificationStatus;
  displayNameProof: string;
  socialLinks: string[];
  musicLinks: string[];
  notes?: string;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedVerifications {
  verifications: VerificationView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Verification state exposed on an artist's public profile. */
export interface VerificationBadge {
  verified: boolean;
  verifiedAt?: Date | null;
  status?: VerificationStatus;
}

/**
 * Service for managing artist profile updates including profile image
 * and page cover uploads to S3, plus artist verification badges (Issue #92).
 */
export class ArtistProfileService {
  private userRepo: Repository<User>;
  private verificationRepo: Repository<ArtistVerification>;
  private followRepo: Repository<UserFollow>;
  private songRepo: Repository<Song>;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    this.verificationRepo = AppDataSource.getRepository(ArtistVerification);
    this.followRepo = AppDataSource.getRepository(UserFollow);
    this.songRepo = AppDataSource.getRepository(Song);
  }

  /**
   * Upload a local image file to S3 and return the public URL.
   *
   * @param localPath - Absolute path to the image file on disk.
   * @param folder - S3 folder prefix (e.g. "profile-images", "page-covers").
   * @returns The S3 URL of the uploaded file.
   */
  private async uploadToS3(localPath: string, folder: string) {
    const buffer = fs.readFileSync(localPath);
    const fileId = crypto.randomUUID();
    const fileName = `${fileId}_${path.basename(localPath)}`;

    const upload = await s3
      .upload({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: `${folder}/${fileName}`,
        Body: buffer,
        ContentType: 'image/png',
      })
      .promise();

    fs.unlinkSync(localPath); // clean temp
    return upload.Location;
  }

  /**
   * Update an artist's profile including bio, website, and optional image uploads.
   * Profile images are uploaded to S3 and their URLs are stored on the user record.
   *
   * @param userId - ID of the artist user.
   * @param profileData - Partial profile fields and optional file uploads.
   * @returns Updated User entity.
   * @throws {Error} If user not found.
   */
  async updateArtistProfile(
    userId: string,
    profileData: Partial<UpdateArtistProfileDTO>,
  ): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    // Prepare the update data with processed files
    // exclude file objects (profileImage, pageCover) before assigning to Partial<User>
    const { profileImage: _profileImage, pageCover: _pageCover, ...rest } = profileData;
    const updateData: Partial<User> = { ...rest };

    // upload profile image if provided
    if (
      profileData.profileImage &&
      typeof profileData.profileImage === 'object' &&
      'path' in profileData.profileImage
    ) {
      const uploadedUrl = await this.uploadToS3(profileData.profileImage.path, 'profile-images');
      updateData.profileImage = uploadedUrl;
    }

    // upload page cover if provided
    if (
      profileData.pageCover &&
      typeof profileData.pageCover === 'object' &&
      'path' in profileData.pageCover
    ) {
      const uploadedUrl = await this.uploadToS3(profileData.pageCover.path, 'page-covers');
      updateData.pageCover = uploadedUrl;
    }

    Object.assign(user, updateData);

    // Save the updated user

    return this.userRepo.save(user);
  }

  /**
   * Submits a verification application for an artist (Issue #92).
   *
   * One pending application per user: re-applying while a decision is
   * outstanding updates the existing application rather than queueing a second.
   * An already-verified artist cannot re-apply.
   *
   * @param userId - Applicant, who must hold the artist role
   * @param application - Display-name proof plus social and music links
   * @returns The pending application
   * @throws {AppError} When the user is missing, is not an artist, is already
   *   verified, or the supplied links are invalid
   */
  async applyForVerification(
    userId: string,
    application: VerificationApplicationInput,
  ): Promise<VerificationView> {
    validateUUID(userId, 'userId');

    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw AppError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    if (user.role !== UserRole.ARTIST && user.role !== UserRole.ADMIN) {
      throw AppError.authorization('Only artist accounts can apply for verification');
    }

    validateStringLength(application.displayNameProof, 'displayNameProof', 1, 200);

    const socialLinks = this.normalizeLinks(application.socialLinks, 'socialLinks');
    const musicLinks = this.normalizeLinks(application.musicLinks, 'musicLinks');

    if (socialLinks.length === 0) {
      throw AppError.validation('At least one social link is required', { field: 'socialLinks' });
    }

    if (musicLinks.length === 0) {
      throw AppError.validation('At least one music link is required', { field: 'musicLinks' });
    }

    const approved = await this.verificationRepo.findOne({
      where: { userId, status: VerificationStatus.APPROVED },
    });

    if (approved) {
      throw AppError.conflict('This account is already verified');
    }

    const pending = await this.verificationRepo.findOne({
      where: { userId, status: VerificationStatus.PENDING },
    });

    if (pending) {
      pending.displayNameProof = application.displayNameProof.trim();
      pending.socialLinks = socialLinks;
      pending.musicLinks = musicLinks;
      pending.notes = application.notes?.trim();

      return this.toVerificationView(await this.verificationRepo.save(pending));
    }

    const verification = this.verificationRepo.create({
      userId,
      status: VerificationStatus.PENDING,
      displayNameProof: application.displayNameProof.trim(),
      socialLinks,
      musicLinks,
      notes: application.notes?.trim(),
    });

    return this.toVerificationView(await this.verificationRepo.save(verification));
  }

  /**
   * Lists verification applications for the admin review queue (Issue #92).
   *
   * @param status - Status filter; defaults to pending applications
   * @param page - 1-based page number
   * @param limit - Page size, capped at {@link MAX_VERIFICATION_LIMIT}
   * @returns Paginated applications, oldest first so the queue is FIFO
   */
  async listVerifications(
    status: VerificationStatus = VerificationStatus.PENDING,
    page = 1,
    limit = DEFAULT_VERIFICATION_LIMIT,
  ): Promise<PaginatedVerifications> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(
      Math.max(1, Math.floor(limit) || DEFAULT_VERIFICATION_LIMIT),
      MAX_VERIFICATION_LIMIT,
    );

    const [verifications, total] = await this.verificationRepo.findAndCount({
      where: { status },
      order: { createdAt: 'ASC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      verifications: verifications.map((verification) => this.toVerificationView(verification)),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /**
   * Approves a pending verification application (Issue #92).
   *
   * @param verificationId - Application to approve
   * @param adminId - Admin performing the review
   * @returns The approved application
   * @throws {AppError} When the application is missing or already decided
   */
  async approveVerification(verificationId: string, adminId: string): Promise<VerificationView> {
    const verification = await this.loadPendingVerification(verificationId);

    verification.status = VerificationStatus.APPROVED;
    verification.reviewedBy = adminId;
    verification.reviewedAt = new Date();
    verification.rejectionReason = null;

    return this.toVerificationView(await this.verificationRepo.save(verification));
  }

  /**
   * Rejects a pending verification application with a reason (Issue #92).
   *
   * @param verificationId - Application to reject
   * @param adminId - Admin performing the review
   * @param reason - Why the application was rejected; surfaced to the applicant
   * @returns The rejected application
   * @throws {AppError} When the application is missing, already decided, or no
   *   reason was supplied
   */
  async rejectVerification(
    verificationId: string,
    adminId: string,
    reason: string,
  ): Promise<VerificationView> {
    validateStringLength(reason, 'reason', 1, VERIFICATION_REASON_MAX_LENGTH);

    const verification = await this.loadPendingVerification(verificationId);

    verification.status = VerificationStatus.REJECTED;
    verification.reviewedBy = adminId;
    verification.reviewedAt = new Date();
    verification.rejectionReason = reason.trim();

    return this.toVerificationView(await this.verificationRepo.save(verification));
  }

  /**
   * Resolves the verification badge shown on an artist's profile (Issue #92).
   *
   * @param userId - Artist whose badge is being resolved
   * @returns Whether the artist is verified, and when they were approved
   */
  async getVerificationBadge(userId: string): Promise<VerificationBadge> {
    validateUUID(userId, 'userId');

    const approved = await this.verificationRepo.findOne({
      where: { userId, status: VerificationStatus.APPROVED },
      order: { reviewedAt: 'DESC' },
    });

    if (approved) {
      return {
        verified: true,
        verifiedAt: approved.reviewedAt,
        status: VerificationStatus.APPROVED,
      };
    }

    const latest = await this.verificationRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return { verified: false, status: latest?.status };
  }

  /**
   * Returns the caller's own latest application, so an artist can see where
   * their request stands.
   *
   * @param userId - Applicant
   * @returns The latest application, or null when the user never applied
   */
  async getMyVerification(userId: string): Promise<VerificationView | null> {
    validateUUID(userId, 'userId');

    const verification = await this.verificationRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return verification ? this.toVerificationView(verification) : null;
  }

  /**
   * Loads an application that is still awaiting a decision.
   *
   * @throws {AppError} When the application is missing or already reviewed
   */
  private async loadPendingVerification(verificationId: string): Promise<ArtistVerification> {
    validateUUID(verificationId, 'id');

    const verification = await this.verificationRepo.findOne({ where: { id: verificationId } });

    if (!verification) {
      throw AppError.notFound('Verification application not found');
    }

    if (verification.status !== VerificationStatus.PENDING) {
      throw AppError.conflict(`Application has already been ${verification.status}`);
    }

    return verification;
  }

  /**
   * Validates and de-duplicates a list of supporting links.
   *
   * Only http(s) URLs are accepted — the links are shown to reviewers, so
   * other schemes (javascript:, data:) must never reach the review UI.
   */
  private normalizeLinks(links: unknown, fieldName: string): string[] {
    if (links === undefined || links === null) {
      return [];
    }

    if (!Array.isArray(links)) {
      throw AppError.validation(`${fieldName} must be an array of URLs`, { field: fieldName });
    }

    if (links.length > VERIFICATION_MAX_LINKS) {
      throw AppError.validation(
        `${fieldName} cannot contain more than ${VERIFICATION_MAX_LINKS} links`,
        {
          field: fieldName,
          value: links.length,
        },
      );
    }

    const normalized = links
      .filter((link): link is string => typeof link === 'string')
      .map((link) => link.trim())
      .filter((link) => link !== '');

    for (const link of normalized) {
      if (link.length > VERIFICATION_LINK_MAX_LENGTH) {
        throw AppError.validation(
          `Each ${fieldName} entry cannot exceed ${VERIFICATION_LINK_MAX_LENGTH} characters`,
          { field: fieldName, value: link },
        );
      }

      let parsed: URL;

      try {
        parsed = new URL(link);
      } catch {
        throw AppError.validation(`${fieldName} contains an invalid URL: ${link}`, {
          field: fieldName,
          value: link,
        });
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw AppError.validation(`${fieldName} entries must be http(s) URLs`, {
          field: fieldName,
          value: link,
        });
      }
    }

    return [...new Set(normalized)];
  }

  /** Maps an entity to its wire representation. */
  private toVerificationView(verification: ArtistVerification): VerificationView {
    return {
      id: verification.id,
      userId: verification.userId,
      status: verification.status,
      displayNameProof: verification.displayNameProof,
      socialLinks: verification.socialLinks ?? [],
      musicLinks: verification.musicLinks ?? [],
      notes: verification.notes,
      reviewedBy: verification.reviewedBy,
      reviewedAt: verification.reviewedAt,
      rejectionReason: verification.rejectionReason,
      createdAt: verification.createdAt,
      updatedAt: verification.updatedAt,
    };
  }

  // ── Follow / Unfollow (Issue #81) ────────────────────────────────────────────

  /**
   * Follow an artist. Idempotent — following an already-followed artist
   * returns 200 without error.
   */
  async followArtist(
    followerId: string,
    followingId: string,
  ): Promise<{ followerCount: number; followingCount: number }> {
    validateUUID(followerId, 'followerId');
    validateUUID(followingId, 'followingId');

    if (followerId === followingId) {
      throw AppError.validation('Cannot follow yourself');
    }

    const target = await this.userRepo.findOneBy({ id: followingId });
    if (!target) {
      throw AppError.notFound('Artist not found');
    }

    const existing = await this.followRepo.findOne({
      where: { followerId, followingId },
    });

    if (!existing) {
      await this.followRepo.insert({ followerId, followingId });
    }

    const [followerCount, followingCount] = await Promise.all([
      this.followRepo.count({ where: { followingId } }),
      this.followRepo.count({ where: { followerId: followingId } }),
    ]);

    return { followerCount, followingCount };
  }

  /**
   * Unfollow an artist. Idempotent — unfollowing a non-followed artist
   * returns 200 without error.
   */
  async unfollowArtist(
    followerId: string,
    followingId: string,
  ): Promise<{ followerCount: number; followingCount: number }> {
    validateUUID(followerId, 'followerId');
    validateUUID(followingId, 'followingId');

    await this.followRepo.delete({ followerId, followingId });

    const [followerCount, followingCount] = await Promise.all([
      this.followRepo.count({ where: { followingId } }),
      this.followRepo.count({ where: { followerId: followingId } }),
    ]);

    return { followerCount, followingCount };
  }

  /** Get followers of an artist with pagination. */
  async getFollowers(
    artistId: string,
    page = 1,
    limit = 20,
  ): Promise<{ users: Partial<User>[]; total: number; page: number; limit: number }> {
    validateUUID(artistId, 'artistId');

    const [follows, total] = await this.followRepo.findAndCount({
      where: { followingId: artistId },
      relations: ['follower'],
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    const users = follows.map((f) => ({
      id: f.follower.id,
      username: f.follower.username,
      name: f.follower.name,
      profileImage: f.follower.profileImage,
      bio: f.follower.bio,
    }));

    return { users, total, page, limit };
  }

  /** Get who an artist follows with pagination. */
  async getFollowing(
    artistId: string,
    page = 1,
    limit = 20,
  ): Promise<{ users: Partial<User>[]; total: number; page: number; limit: number }> {
    validateUUID(artistId, 'artistId');

    const [follows, total] = await this.followRepo.findAndCount({
      where: { followerId: artistId },
      relations: ['following'],
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    const users = follows.map((f) => ({
      id: f.following.id,
      username: f.following.username,
      name: f.following.name,
      profileImage: f.following.profileImage,
      bio: f.following.bio,
    }));

    return { users, total, page, limit };
  }

  /** Get follower and following counts for an artist. */
  async getFollowCounts(artistId: string): Promise<{
    followerCount: number;
    followingCount: number;
  }> {
    const [followerCount, followingCount] = await Promise.all([
      this.followRepo.count({ where: { followingId: artistId } }),
      this.followRepo.count({ where: { followerId: artistId } }),
    ]);
    return { followerCount, followingCount };
  }

  /**
   * Get personalized feed — recent songs from artists the user follows.
   * Returns ready, un-flagged songs sorted by recency.
   */
  async getFeed(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ songs: Song[]; total: number; page: number; limit: number }> {
    validateUUID(userId, 'userId');

    const follows = await this.followRepo.find({
      where: { followerId: userId },
      select: ['followingId'],
    });

    const followingIds = follows.map((f) => f.followingId);

    if (followingIds.length === 0) {
      return { songs: [], total: 0, page, limit };
    }

    const [songs, total] = await this.songRepo.findAndCount({
      where: { artistId: In(followingIds), status: 'ready', flagged: false },
      relations: ['user'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { songs, total, page, limit };
  }
}
