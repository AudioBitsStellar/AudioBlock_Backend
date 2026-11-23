import { IsIn, IsString, Length } from 'class-validator';
import { AccountSuspensionType } from '../entities/User';

/** Body for `POST /api/admin/users/:id/suspend` (#980). */
export class SuspendAccountDTO {
  @IsIn(Object.values(AccountSuspensionType), {
    message: `type must be one of: ${Object.values(AccountSuspensionType).join(', ')}`,
  })
  type!: AccountSuspensionType;

  @IsString()
  @Length(1, 500, { message: 'reason must be between 1 and 500 characters' })
  reason!: string;
}
