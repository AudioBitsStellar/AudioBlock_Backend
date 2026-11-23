import { ageInYears, assertMeetsMinimumAge, getMinimumSignupAge } from '../utils/minimumAge';

describe('ageInYears', () => {
  it('counts whole years and does not round up before the birthday', () => {
    expect(ageInYears('2000-06-15', new Date('2026-06-14T12:00:00Z'))).toBe(25);
  });

  it('increments on the birthday itself', () => {
    expect(ageInYears('2000-06-15', new Date('2026-06-15T00:00:00Z'))).toBe(26);
  });

  it('returns null for a date of birth in the future', () => {
    expect(ageInYears('2030-01-01', new Date('2026-06-15T00:00:00Z'))).toBeNull();
  });

  it('rejects impossible calendar dates instead of rolling them over', () => {
    expect(ageInYears('2023-02-29', new Date('2026-06-15T00:00:00Z'))).toBeNull();
    expect(ageInYears('2023-02-30', new Date('2026-06-15T00:00:00Z'))).toBeNull();
  });

  it('accepts a leap day in a leap year', () => {
    expect(ageInYears('2024-02-29', new Date('2026-03-01T00:00:00Z'))).toBe(2);
  });

  it('rejects values that are not YYYY-MM-DD', () => {
    expect(ageInYears('15/06/2000', new Date('2026-06-15T00:00:00Z'))).toBeNull();
    expect(ageInYears('2000-6-5', new Date('2026-06-15T00:00:00Z'))).toBeNull();
  });

  it('rejects implausibly old dates', () => {
    expect(ageInYears('1800-01-01', new Date('2026-06-15T00:00:00Z'))).toBeNull();
  });
});

describe('getMinimumSignupAge', () => {
  const original = process.env.MINIMUM_SIGNUP_AGE;

  afterEach(() => {
    if (original === undefined) delete process.env.MINIMUM_SIGNUP_AGE;
    else process.env.MINIMUM_SIGNUP_AGE = original;
  });

  it('defaults to 18 when unset', () => {
    delete process.env.MINIMUM_SIGNUP_AGE;
    expect(getMinimumSignupAge()).toBe(18);
  });

  it('uses a valid configured value', () => {
    process.env.MINIMUM_SIGNUP_AGE = '16';
    expect(getMinimumSignupAge()).toBe(16);
  });

  it.each(['12', '100', 'abc', '', '17.5'])(
    'falls back to 18 for the invalid value %j',
    (value) => {
      process.env.MINIMUM_SIGNUP_AGE = value;
      expect(getMinimumSignupAge()).toBe(18);
    },
  );
});

describe('assertMeetsMinimumAge', () => {
  const original = process.env.MINIMUM_SIGNUP_AGE;
  const today = new Date('2026-06-15T00:00:00Z');

  beforeEach(() => {
    delete process.env.MINIMUM_SIGNUP_AGE;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.MINIMUM_SIGNUP_AGE;
    else process.env.MINIMUM_SIGNUP_AGE = original;
  });

  it('passes for someone exactly at the minimum age', () => {
    expect(() => assertMeetsMinimumAge('2008-06-15', today)).not.toThrow();
  });

  it('throws a 403 for someone one day short of the minimum age', () => {
    try {
      assertMeetsMinimumAge('2008-06-16', today);
      throw new Error('expected assertMeetsMinimumAge to throw');
    } catch (error: any) {
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('You must be at least 18 years old to create an account.');
    }
  });

  it('throws a 400 validation error for an impossible date', () => {
    try {
      assertMeetsMinimumAge('2001-02-30', today);
      throw new Error('expected assertMeetsMinimumAge to throw');
    } catch (error: any) {
      expect(error.statusCode).toBe(400);
    }
  });
});
