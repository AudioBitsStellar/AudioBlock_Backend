import { Repository } from "typeorm";
import { ArtistProfile } from "../entities/AristProfile";
import AppDataSource from "../config/db";
import { CreateArtistProfileDTO } from "../dtos/CreateArtistProfileDTO";
import { User } from "../entities/User";

export class ArtistProfileService {

    private artistProfileRepo: Repository<ArtistProfile>
    private userRepo: Repository<User>;


    constructor () {
        this.artistProfileRepo = AppDataSource.getRepository(ArtistProfile)
        this.userRepo = AppDataSource.getRepository(User);
    }

    async createArtistProfile( userId: string, data: CreateArtistProfileDTO): Promise<{ profile: ArtistProfile; }> {

        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) {
            throw new Error("User not found");
        }

        // const dto = Object.assign(new CreateArtistProfileDTO(), data);
        const artistProfile = this.artistProfileRepo.create({
            ...data,
            user, // link the User entity
        });

        const profile = await this.artistProfileRepo.save(artistProfile);
        return { profile };

    }

    async getArtistProfileById(id: string): Promise<ArtistProfile | null> {
        return await this.artistProfileRepo.findOneBy({ id });
    }

    async updateArtistProfile(id: string, data: Partial<ArtistProfile>): Promise<ArtistProfile | null> {
        const profile = await this.artistProfileRepo.findOneBy({ id });
        if (!profile) {
            throw new Error("Profile not found");
        }

        Object.assign(profile, data);
        return await this.artistProfileRepo.save(profile);
    }

    async deleteArtistProfile(id: string): Promise<ArtistProfile | null> {
        const profile = await this.artistProfileRepo.findOneBy({ id });
        if (!profile) {
            throw new Error("Profile not found");
        }
        return await this.artistProfileRepo.remove(profile);
    }

    async getAllArtistProfiles(): Promise<ArtistProfile[]> {
        return await this.artistProfileRepo.find();
    }

    // Search full profile by any search
    async searchArtistProfile(query: string): Promise<ArtistProfile[]> {
        return await this.artistProfileRepo.find({
            where: [
                { artist_name: query },
                { twitter_handle: query },
                { distro_kid: query },
            ],
        });
    }        
}