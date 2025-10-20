import { ArtistProfileService } from '../services/ArtistProfileService';
import { handleError } from '../utils/helpers';
import { ArtistProfile } from './../entities/AristProfile';
import { Request, Response } from 'express';

export class ArtistProfileController {

    private artistProfileService: ArtistProfileService;

    constructor() {
        this.artistProfileService = new ArtistProfileService();
    }

    createProfile = async(req: Request, res: Response) => {
        try {
            const userId = req.user?.id;
            

            if (!userId) {
                return res.status(401).json({
                success: false,
                message: "Unauthorized: user not found in token",
                });
            }
           const profile = req.body;
           const newProfile = await this.artistProfileService.createArtistProfile(userId,profile);
           res.status(201).json(newProfile);
        
        } catch (error) {
            handleError(res, error);
        }
    }

    
    
}