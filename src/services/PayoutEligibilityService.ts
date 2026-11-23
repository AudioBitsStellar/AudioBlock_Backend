import AppDataSource from '../config/db';
import { RoyaltyPayout } from '../entities/RoyaltyPayout';
import { User } from '../entities/User';

/**
 * Gates royalty payouts on artist verification (#979).
 *
 * Sales are always recorded so no revenue is lost. A payout for an artist who
 * is not verified is recorded with `heldUntilVerified = true` and stays held
 * until the artist's verification is approved, at which point every held payout
 * is released in one update.
 */
export class PayoutEligibilityService {
  /** True when the artist's account carries an approved verification badge. */
  static async isArtistVerified(artistId: string): Promise<boolean> {
    const artist = await AppDataSource.getRepository(User).findOne({
      where: { id: artistId },
      select: ['id', 'isVerified'],
    });
    return artist?.isVerified === true;
  }

  /**
   * Release every payout held for an artist, typically right after their
   * verification is approved.
   *
   * @returns The number of payouts released.
   */
  static async releaseHeldPayouts(artistId: string): Promise<number> {
    const result = await AppDataSource.getRepository(RoyaltyPayout).update(
      { artist_id: artistId, heldUntilVerified: true },
      { heldUntilVerified: false },
    );
    return result.affected ?? 0;
  }
}
