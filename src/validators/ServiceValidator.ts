/**
 * Service-layer validation utilities.
 * Provides reusable validation functions for service boundaries.
 */

import { AppError } from '../errors/AppError';
import {
  ERROR_MESSAGES,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  SONG_TITLE_MIN_LENGTH,
  SONG_TITLE_MAX_LENGTH,
  SONG_DESCRIPTION_MAX_LENGTH,
  ARTIST_BIO_MAX_LENGTH,
  ALBUM_TITLE_MIN_LENGTH,
  ALBUM_TITLE_MAX_LENGTH,
  STELLAR_PUBLIC_KEY_LENGTH,
  BLOCKCHAIN_REGEX,
  REGEX_PATTERNS,
} from '../config/constants';

/**
 * Validates that a value is not null or undefined
 */
export function validateRequired(value: unknown, fieldName: string): void {
  if (value === null || value === undefined || value === '') {
    throw AppError.validation(`${fieldName} is required`, { field: fieldName });
  }
}

/**
 * Validates that multiple fields are present
 */
export function validateRequiredFields(data: Record<string, unknown>, fields: string[]): void {
  const missingFields = fields.filter((field) => {
    const value = data[field];
    return value === null || value === undefined || value === '';
  });

  if (missingFields.length > 0) {
    throw AppError.validation(
      `${ERROR_MESSAGES.MISSING_REQUIRED_FIELDS}: ${missingFields.join(', ')}`,
      {
        field: 'multiple',
        value: missingFields,
      },
    );
  }
}

/**
 * Validates email format
 */
export function validateEmail(email: string): void {
  validateRequired(email, 'email');

  if (typeof email !== 'string' || !REGEX_PATTERNS.EMAIL.test(email)) {
    throw AppError.validation('Invalid email format', {
      field: 'email',
      value: email,
    });
  }
}

/**
 * Validates username format and length
 */
export function validateUsername(username: string): void {
  validateRequired(username, 'username');

  if (typeof username !== 'string') {
    throw AppError.validation('Username must be a string', {
      field: 'username',
    });
  }

  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    throw AppError.validation(
      `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters`,
      {
        field: 'username',
        value: username,
        constraint: `length:${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH}`,
      },
    );
  }

  if (!REGEX_PATTERNS.USERNAME.test(username)) {
    throw AppError.validation(
      'Username can only contain letters, numbers, underscores, and hyphens',
      {
        field: 'username',
        value: username,
      },
    );
  }
}

/**
 * Validates password strength
 */
export function validatePassword(password: string): void {
  validateRequired(password, 'password');

  if (typeof password !== 'string') {
    throw AppError.validation('Password must be a string', {
      field: 'password',
    });
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    throw AppError.validation(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`, {
      field: 'password',
      constraint: `minLength:${PASSWORD_MIN_LENGTH}`,
    });
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    throw AppError.validation(`Password cannot exceed ${PASSWORD_MAX_LENGTH} characters`, {
      field: 'password',
      constraint: `maxLength:${PASSWORD_MAX_LENGTH}`,
    });
  }
}

/**
 * Validates Stellar public key (G-address)
 */
export function validateStellarPublicKey(publicKey: string): void {
  validateRequired(publicKey, 'stellarPublicKey');

  if (typeof publicKey !== 'string') {
    throw AppError.validation('Stellar public key must be a string', {
      field: 'stellarPublicKey',
    });
  }

  if (publicKey.length !== STELLAR_PUBLIC_KEY_LENGTH) {
    throw AppError.validation(
      `Stellar public key must be exactly ${STELLAR_PUBLIC_KEY_LENGTH} characters`,
      {
        field: 'stellarPublicKey',
        value: publicKey,
      },
    );
  }

  if (!BLOCKCHAIN_REGEX.STELLAR_PUBLIC_KEY.test(publicKey)) {
    throw AppError.validation('Invalid Stellar public key format (must start with G)', {
      field: 'stellarPublicKey',
      value: publicKey,
    });
  }
}

/**
 * Validates Ethereum wallet address
 */
export function validateEthereumAddress(address: string): void {
  validateRequired(address, 'walletAddress');

  if (typeof address !== 'string') {
    throw AppError.validation('Wallet address must be a string', {
      field: 'walletAddress',
    });
  }

  if (!BLOCKCHAIN_REGEX.ETHEREUM_ADDRESS.test(address)) {
    throw AppError.validation('Invalid Ethereum address format', {
      field: 'walletAddress',
      value: address,
    });
  }
}

/**
 * Validates string length constraints
 */
export function validateStringLength(
  value: string,
  fieldName: string,
  minLength: number,
  maxLength: number,
): void {
  validateRequired(value, fieldName);

  if (typeof value !== 'string') {
    throw AppError.validation(`${fieldName} must be a string`, {
      field: fieldName,
    });
  }

  if (value.length < minLength) {
    throw AppError.validation(`${fieldName} must be at least ${minLength} characters`, {
      field: fieldName,
      value: value,
      constraint: `minLength:${minLength}`,
    });
  }

  if (value.length > maxLength) {
    throw AppError.validation(`${fieldName} cannot exceed ${maxLength} characters`, {
      field: fieldName,
      value: value,
      constraint: `maxLength:${maxLength}`,
    });
  }
}

/**
 * Validates song title
 */
export function validateSongTitle(title: string): void {
  validateStringLength(title, 'title', SONG_TITLE_MIN_LENGTH, SONG_TITLE_MAX_LENGTH);
}

/**
 * Validates song description
 */
export function validateSongDescription(description: string): void {
  if (description) {
    validateStringLength(description, 'description', 0, SONG_DESCRIPTION_MAX_LENGTH);
  }
}

/**
 * Validates album title
 */
export function validateAlbumTitle(title: string): void {
  validateStringLength(title, 'title', ALBUM_TITLE_MIN_LENGTH, ALBUM_TITLE_MAX_LENGTH);
}

/**
 * Validates artist bio
 */
export function validateArtistBio(bio: string): void {
  if (bio) {
    validateStringLength(bio, 'bio', 0, ARTIST_BIO_MAX_LENGTH);
  }
}

/**
 * Validates numeric range
 */
export function validateNumberRange(
  value: number,
  fieldName: string,
  min: number,
  max: number,
): void {
  if (typeof value !== 'number' || isNaN(value)) {
    throw AppError.validation(`${fieldName} must be a valid number`, {
      field: fieldName,
      value: value,
    });
  }

  if (value < min || value > max) {
    throw AppError.validation(`${fieldName} must be between ${min} and ${max}`, {
      field: fieldName,
      value: value,
      constraint: `range:${min}-${max}`,
    });
  }
}

/**
 * Validates positive integer
 */
export function validatePositiveInteger(value: number, fieldName: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw AppError.validation(`${fieldName} must be a positive integer`, {
      field: fieldName,
      value: value,
    });
  }
}

/**
 * Validates UUID format
 */
export function validateUUID(value: string, fieldName: string): void {
  validateRequired(value, fieldName);

  if (typeof value !== 'string' || !REGEX_PATTERNS.UUID.test(value)) {
    throw AppError.validation(`${fieldName} must be a valid UUID`, {
      field: fieldName,
      value: value,
    });
  }
}

/**
 * Validates enum value
 */
export function validateEnum<T extends string>(
  value: T,
  fieldName: string,
  allowedValues: readonly T[],
): void {
  validateRequired(value, fieldName);

  if (!allowedValues.includes(value)) {
    throw AppError.validation(`${fieldName} must be one of: ${allowedValues.join(', ')}`, {
      field: fieldName,
      value: value,
      constraint: `enum:${allowedValues.join('|')}`,
    });
  }
}

/**
 * Validates ownership (user owns resource)
 */
export function validateOwnership(
  resourceOwnerId: string,
  requestingUserId: string,
  resourceType: string,
): void {
  if (resourceOwnerId !== requestingUserId) {
    throw AppError.authorization(`You do not have permission to modify this ${resourceType}`, {
      field: 'userId',
      value: requestingUserId,
    });
  }
}

/**
 * Validates status transition
 */
export function validateStatusTransition(
  currentStatus: string,
  newStatus: string,
  allowedTransitions: Record<string, string[]>,
): void {
  const allowed = allowedTransitions[currentStatus] || [];

  if (!allowed.includes(newStatus)) {
    throw AppError.businessLogic(
      `Invalid status transition from ${currentStatus} to ${newStatus}`,
      {
        field: 'status',
        value: newStatus,
        constraint: `allowedTransitions:${allowed.join('|')}`,
      },
    );
  }
}
