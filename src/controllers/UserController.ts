import { UserService } from './../services/UserService';
import { ArtistProfileService } from '../services/ArtistProfileService';
import { Request, Response } from 'express';
import { handleError } from '../utils/helpers';
import { HTTP_STATUS } from '../config/constants';
import { routeParam } from '../utils/routeParams';

/**
 * Thin HTTP layer for user-related endpoints.
 * Delegates all business logic to UserService.
 */
export class UserController {
  private userService: UserService;
  private artistProfileService: ArtistProfileService;

  constructor() {
    this.userService = new UserService();
    this.artistProfileService = new ArtistProfileService();
  }

  getUserByWalletAddress = async (req: Request, res: Response): Promise<void> => {
    try {
      const walletAddress = Array.isArray(req.params.walletAddress)
        ? req.params.walletAddress[0]
        : req.params.walletAddress;

      const user = await this.userService.getUserByWalletAddress(walletAddress);
      res.status(HTTP_STATUS.OK).json(user);
    } catch (error) {
      handleError(req, res, error);
    }
  };

  getUserById = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const user = await this.userService.getUserById(id);
      if (!user) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'User not found' });
        return;
      }
      // Augment with follow counts (Issue #81)
      const followCounts = await this.artistProfileService.getFollowCounts(id);
      res.status(HTTP_STATUS.OK).json({ ...user, ...followCounts });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  getAllUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const users = await this.userService.getAllUsers();
      res.status(HTTP_STATUS.OK).json(users);
    } catch (error) {
      handleError(req, res, error);
    }
  };

  updateUser = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const user = await this.userService.updateUser(id, req.body);
      res.status(HTTP_STATUS.OK).json(user);
    } catch (error) {
      handleError(req, res, error);
    }
  };

  deleteUser = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const user = await this.userService.deleteUser(id);
      res.status(HTTP_STATUS.OK).json(user);
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** PUT /api/users/profile — update own profile (Issue #83). */
  updateProfile = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
        return;
      }
      const profile = await this.userService.updateProfile(userId, req.body);
      res.status(HTTP_STATUS.OK).json({ success: true, data: profile });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** GET /api/users/profile — get own full profile (Issue #83). */
  getOwnProfile = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
        return;
      }
      const profile = await this.userService.getOwnProfile(userId);
      res.status(HTTP_STATUS.OK).json({ success: true, data: profile });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** GET /api/users/:id/public — get public profile (Issue #83). */
  getPublicProfile = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = routeParam(req.params.id);
      const profile = await this.userService.getPublicProfile(id);
      res.status(HTTP_STATUS.OK).json({ success: true, data: profile });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
