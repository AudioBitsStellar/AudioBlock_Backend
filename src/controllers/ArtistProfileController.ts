import { validateOrReject } from 'class-validator';
import { UpdateArtistProfileDTO } from '../dtos/UpdateArtistProfileDTO';
import { ArtistProfileService } from '../services/ArtistProfileService';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';
import { Request, Response } from 'express';
import fs from 'fs';
import { HTTP_STATUS } from '../config/constants';
import { routeParam } from '../utils/routeParams';

export class ArtistProfileController {
  private artistProfileService: ArtistProfileService;

  constructor() {
    this.artistProfileService = new ArtistProfileService();
  }

  updateProfile = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        throw AppError.authentication('Unauthorized: user not found in token');
      }

      // combine body + uploaded files into DTO
      const dto = Object.assign(new UpdateArtistProfileDTO(), {
        ...req.body,
        profileImage: (req as any).files?.['profileImage']?.[0],
        pageCover: (req as any).files?.['pageCover']?.[0],
      });

      // validate DTO
      await validateOrReject(dto);
      const updatedProfile = await this.artistProfileService.updateArtistProfile(userId, dto);
      return res.status(200).json({ success: true, data: updatedProfile });
    } catch (error) {
      handleError(req, res, error);
    } finally {
      // optional: clean up temp uploads if validation fails
      if (req.files) {
        Object.values(req.files).forEach((arr: any) =>
          arr.forEach((f: any) => fs.existsSync(f.path) && fs.unlinkSync(f.path)),
        );
      }
    }
  };

  /**
   * Submit a verification application for the calling artist (Issue #92).
   * POST /api/artist/verify/apply
   */
  applyForVerification = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(
          req,
          res,
          AppError.authentication('Unauthorized: user not found in token'),
        );
      }

      const { displayNameProof, socialLinks, musicLinks, notes } = req.body;

      const verification = await this.artistProfileService.applyForVerification(userId, {
        displayNameProof,
        socialLinks,
        musicLinks,
        notes,
      });

      return res.status(HTTP_STATUS.CREATED).json({
        message: 'Verification application submitted successfully',
        verification,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Return the calling artist's latest verification application (Issue #92).
   * GET /api/artist/verify/me
   */
  getMyVerification = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        return handleError(
          req,
          res,
          AppError.authentication('Unauthorized: user not found in token'),
        );
      }

      const verification = await this.artistProfileService.getMyVerification(userId);

      return res.status(HTTP_STATUS.OK).json({ verification });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Expose an artist's verification badge on their public profile (Issue #92).
   * GET /api/artist/:id/verification
   */
  getVerificationBadge = async (req: Request, res: Response) => {
    try {
      const artistId = routeParam(req.params.id);
      const badge = await this.artistProfileService.getVerificationBadge(artistId);

      return res.status(HTTP_STATUS.OK).json({ userId: artistId, ...badge });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  // ── Follow / Unfollow / Feed (Issue #81) ──────────────────────────────────────

  /** POST /api/artists/:id/follow */
  followArtist = async (req: Request, res: Response) => {
    try {
      const followerId = (req as any).user?.id;
      if (!followerId) {
        return handleError(req, res, AppError.authentication('Unauthorized'));
      }
      const artistId = routeParam(req.params.id);
      const result = await this.artistProfileService.followArtist(followerId, artistId);
      return res.status(HTTP_STATUS.OK).json({ success: true, data: result });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** DELETE /api/artists/:id/follow */
  unfollowArtist = async (req: Request, res: Response) => {
    try {
      const followerId = (req as any).user?.id;
      if (!followerId) {
        return handleError(req, res, AppError.authentication('Unauthorized'));
      }
      const artistId = routeParam(req.params.id);
      const result = await this.artistProfileService.unfollowArtist(followerId, artistId);
      return res.status(HTTP_STATUS.OK).json({ success: true, data: result });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** GET /api/artists/:id/followers */
  getFollowers = async (req: Request, res: Response) => {
    try {
      const artistId = routeParam(req.params.id);
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const result = await this.artistProfileService.getFollowers(artistId, page, limit);
      return res.status(HTTP_STATUS.OK).json({ success: true, ...result });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** GET /api/artists/:id/following */
  getFollowing = async (req: Request, res: Response) => {
    try {
      const artistId = routeParam(req.params.id);
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const result = await this.artistProfileService.getFollowing(artistId, page, limit);
      return res.status(HTTP_STATUS.OK).json({ success: true, ...result });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** GET /api/feed — personalized feed of songs from followed artists */
  getFeed = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return handleError(req, res, AppError.authentication('Unauthorized'));
      }
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const result = await this.artistProfileService.getFeed(userId, page, limit);
      return res.status(HTTP_STATUS.OK).json({ success: true, ...result });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
