import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class IntrospectTokenDTO {
  @IsString({ message: 'Token must be a string' })
  @IsNotEmpty({ message: 'Token is required' })
  token!: string;

  @IsString({ message: 'token_type_hint must be a string' })
  @IsOptional()
  token_type_hint?: string;
}

export interface TokenIntrospectionResponse {
  active: boolean;
  scope?: string;
  client_id?: string;
  username?: string;
  token_type?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  sub?: string;
  aud?: string;
  iss?: string;
  jti?: string;
  user_id?: string;
  email?: string;
  role?: string;
  wallet_address?: string;
  stellar_public_key?: string;
  name?: string;
  email_verified?: boolean;
}
