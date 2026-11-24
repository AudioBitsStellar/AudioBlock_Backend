import jwt from 'jsonwebtoken';

export function getJwtVerificationSecrets(): string[] {
  return [process.env.JWT_SECRET, process.env.JWT_SECRET_PREVIOUS]
    .map((secret) => secret?.trim())
    .filter((secret): secret is string => Boolean(secret));
}

export function verifyJwtWithSecrets(token: string, secrets: string[]): jwt.JwtPayload {
  let lastError: unknown;
  for (const secret of secrets) {
    try {
      return jwt.verify(token, secret) as jwt.JwtPayload;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Invalid JWT');
}

export function verifyJwtWithRotation(token: string): jwt.JwtPayload {
  return verifyJwtWithSecrets(token, getJwtVerificationSecrets());
}
