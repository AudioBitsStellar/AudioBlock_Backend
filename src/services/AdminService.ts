import { Repository } from 'typeorm';
import { User, UserRole } from '../entities/User';
import AppDataSource from '../config/db';
import { AppError } from '../errors/AppError';
import { ERROR_MESSAGES } from '../config/constants';
import { validateRequired } from '../validators/ServiceValidator';

/**
 * Service layer for administrative operations.
 * Handles role assignment and other admin-level actions.
 */
export class AdminService {
  private userRepo: Repository<User>;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
  }

  /**
   * Assign a role to a user.
   *
   * @param userId - The UUID of the user to update
   * @param role - The new role to assign
   * @returns The updated User entity
   * @throws {AppError} If user not found or role is invalid
   */
  async assignRole(userId: string, role: UserRole): Promise<User> {
    validateRequired(userId, 'userId');
    validateRequired(role, 'role');

    // Validate that the role is a valid enum value
    if (!Object.values(UserRole).includes(role)) {
      throw AppError.validation(`Invalid role: ${role}`, [
        {
          field: 'role',
          message: `Role must be one of: ${Object.values(UserRole).join(', ')}`,
        },
      ]);
    }

    // Find the user
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) {
      throw AppError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Update the role
    user.role = role;

    // Save and return
    return await this.userRepo.save(user);
  }
}
