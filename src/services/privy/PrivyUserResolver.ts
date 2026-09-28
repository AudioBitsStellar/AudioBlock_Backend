import { DataSource } from 'typeorm';
import AppDataSource from '../../config/db';
import { User, UserRole } from '../../entities/User';
import { AppError } from '../../errors/AppError';
import { PrivyUserNotSyncedError } from './PrivyErrors';

/** The subset of a local user that the auth middleware needs. */
export interface PrivyAuthenticatedUser {
  id: string;
  role: UserRole;
  email?: string;
  username?: string;
  name?: string;
  walletAddress?: string;
  stellarPublicKey?: string;
  emailVerified: boolean;
  profileImage?: string;
}

/**
 * Maps a Privy identity to a local account.
 *
 * Lookup is strictly by `users.privyUserId` — the DID a Privy access token
 * carries in `sub`. Notably this does *not* fall back to matching on email or
 * wallet address, and that is a security decision rather than an omission: both
 * are attacker-controllable on at least one Privy login method, so treating them
 * as proof of identity would let anyone claim an existing account by reusing its
 * email.
 *
 * Creating the local row on first login is deliberately *not* done here. That is
 * the first-login sync endpoint's job (Issue #602), which needs the full
 * identity token to set a username, role, and linked accounts — none of which
 * are present in an access token. Until that lands, a Privy user with no local
 * row is rejected with a specific error so the client knows to call the sync
 * endpoint rather than being bounced with a generic 401.
 */
export class PrivyUserResolver {
  private readonly dataSource: DataSource;

  constructor(dataSource: DataSource = AppDataSource) {
    this.dataSource = dataSource;
  }

  /**
   * Find the local account linked to a Privy identity.
   *
   * The user is re-read from the database on every request rather than trusted
   * from token claims: Privy authenticates the *identity*, not our authorisation
   * state. A role change, a revoked account, and a pending GDPR erasure all have
   * to take effect immediately, and none of them can if we authorise off a
   * cached token body.
   *
   * @param privyUserId - The DID from the token's `sub` claim.
   * @throws {PrivyUserNotSyncedError} No live local account is linked yet.
   */
  async resolve(privyUserId: string): Promise<PrivyAuthenticatedUser> {
    const user = await this.dataSource.getRepository(User).findOneBy({ privyUserId });

    if (!user) {
      throw new PrivyUserNotSyncedError(privyUserId);
    }

    // A tombstoned account still exists in the table, so a not-yet-expired Privy
    // token would otherwise keep authenticating after an Art. 17 erasure. This is
    // the enforcement point for that.
    if (user.deletedAt) {
      throw new PrivyUserNotSyncedError(privyUserId);
    }

    // A pending erasure stops access now, not when the grace period ends — the
    // user has already asked to leave (Issue #633).
    if (user.deletionRequestedAt) {
      throw AppError.authorization('Account deletion is pending for this account');
    }

    return {
      id: user.id,
      role: user.role,
      email: user.email,
      username: user.username,
      name: user.name,
      walletAddress: user.walletAddress,
      stellarPublicKey: user.stellarPublicKey,
      emailVerified: user.emailVerified,
      profileImage: user.profileImage,
    };
  }
}
