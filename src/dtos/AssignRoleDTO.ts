import { IsEnum, IsNotEmpty } from 'class-validator';
import { UserRole } from '../entities/User';

/**
 * DTO for assigning a role to a user.
 * Used by the admin role assignment endpoint.
 */
export class AssignRoleDTO {
  @IsEnum(UserRole, {
    message: `Role must be one of: ${Object.values(UserRole).join(', ')}`,
  })
  @IsNotEmpty({ message: 'Role is required' })
  role!: UserRole;
}
