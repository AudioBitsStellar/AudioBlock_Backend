import { IsEnum } from 'class-validator';
import { UserRole } from '../entities/User';

/** Body for `POST /api/admin/users/:id/role` — assigns a role to a user (#100). */
export class AssignRoleDTO {
  @IsEnum(UserRole)
  role!: UserRole;
}
