import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { User } from '../entities/User';
import fs from 'fs';
import { s3 } from '../config/s3';
import { UpdateArtistProfileDTO } from '../dtos/UpdateArtistProfileDTO';
import path from 'path';

/**
 * Service for managing artist profile updates including profile image
 * and page cover uploads to S3.
 */
export class ArtistProfileService {
  private userRepo: Repository<User>;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
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
    const { profileImage, pageCover, ...rest } = profileData;
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
}
