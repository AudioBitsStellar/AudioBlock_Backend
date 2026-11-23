import { AppError } from '../errors/AppError';

/**
 * Minimum age to create an account when MINIMUM_SIGNUP_AGE is unset. 18 is the
 * conservative default because accounts can hold royalty payouts and sign royalty
 * templates. The policy and the legal basis are in docs/AGE_POLICY.md.
 */
export const DEFAULT_MINIMUM_SIGNUP_AGE = 18;

const MIN_CONFIGURABLE_AGE = 13;
const MAX_CONFIGURABLE_AGE = 99;
const MAX_PLAUSIBLE_AGE = 150;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Minimum signup age, read from MINIMUM_SIGNUP_AGE on each call. An unset, non-integer
 * or out-of-range value (outside 13 to 99) falls back to the default. A bad value
 * therefore never silently lowers the gate.
 */
export function getMinimumSignupAge(): number {
  const parsed = Number((process.env.MINIMUM_SIGNUP_AGE ?? '').trim());
  if (
    Number.isInteger(parsed) &&
    parsed >= MIN_CONFIGURABLE_AGE &&
    parsed <= MAX_CONFIGURABLE_AGE
  ) {
    return parsed;
  }
  return DEFAULT_MINIMUM_SIGNUP_AGE;
}

/**
 * Whole years between a `YYYY-MM-DD` date of birth and `today` (UTC). Returns null
 * when the value is not a real calendar date, lies in the future, or is implausibly old.
 */
export function ageInYears(dateOfBirth: string, today: Date = new Date()): number | null {
  const match = DATE_ONLY_PATTERN.exec(dateOfBirth);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Date.UTC rolls impossible dates over (2023-02-30 becomes 2023-03-02), so require
  // the parsed parts to match what was entered.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  let age = today.getUTCFullYear() - year;
  const monthDelta = today.getUTCMonth() - (month - 1);
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < day)) {
    age -= 1;
  }

  if (age < 0 || age > MAX_PLAUSIBLE_AGE) return null;
  return age;
}

/**
 * Throws unless `dateOfBirth` is a real past date and the person meets the minimum
 * signup age (issue COMP-06). The message never says whether an account already exists.
 */
export function assertMeetsMinimumAge(dateOfBirth: string, today: Date = new Date()): void {
  const age = ageInYears(dateOfBirth, today);
  if (age === null) {
    throw AppError.validation('Date of birth must be a valid past date in YYYY-MM-DD format.');
  }

  const minimum = getMinimumSignupAge();
  if (age < minimum) {
    throw AppError.authorization(
      `You must be at least ${minimum} years old to create an account.`,
      undefined,
      'MINIMUM_AGE_NOT_MET',
    );
  }
}
