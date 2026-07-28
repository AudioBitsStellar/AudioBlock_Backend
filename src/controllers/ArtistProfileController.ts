import { validateOrReject } from 'class-validator';
import { UpdateArtistProfileDTO } from '../dtos/UpdateArtistProfileDTO';
import { ArtistProfileService } from '../services/ArtistProfileService';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';
import { Request, Response } from 'express';
import fs from 'fs';

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
}
