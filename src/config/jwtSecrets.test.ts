import jwt from 'jsonwebtoken';

import { isStrongJwtSecret } from './env';
import { verifyJwtWithSecrets } from './jwtSecrets';

describe('JWT secret rotation', () => {
  const currentSecret = 'current-secret-with-at-least-32-characters';
  const previousSecret = 'previous-secret-with-at-least-32-chars';

  it('accepts tokens signed by the previous secret during rotation', () => {
    const token = jwt.sign({ sub: 'user-1' }, previousSecret);

    expect(verifyJwtWithSecrets(token, [currentSecret, previousSecret])).toMatchObject({
      sub: 'user-1',
    });
  });

  it('rejects tokens signed with an unknown secret', () => {
    const token = jwt.sign({ sub: 'user-1' }, 'untrusted-secret');

    expect(() => verifyJwtWithSecrets(token, [currentSecret, previousSecret])).toThrow();
  });
});

describe('JWT secret strength validation', () => {
  it('requires a non-placeholder secret of at least 32 characters', () => {
    expect(isStrongJwtSecret(undefined)).toBe(false);
    expect(isStrongJwtSecret('secret')).toBe(false);
    expect(isStrongJwtSecret('short-secret')).toBe(false);
    expect(isStrongJwtSecret('a'.repeat(32))).toBe(true);
  });
});
