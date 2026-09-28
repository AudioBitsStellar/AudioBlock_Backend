export interface PrivyConfig {
  appId: string;
  appSecret: string;
  verificationKey: string;
  apiUrl: string;
}

/**
 * Read Privy credentials from the environment (issue #595).
 * Read lazily on every call so tests and restarts never see stale values.
 */
export function getPrivyConfig(): PrivyConfig {
  return {
    appId: process.env.PRIVY_APP_ID || '',
    appSecret: process.env.PRIVY_APP_SECRET || '',
    verificationKey: process.env.PRIVY_JWT_VERIFICATION_KEY || '',
    apiUrl: (process.env.PRIVY_API_URL || 'https://api.privy.io').replace(/\/+$/, ''),
  };
}

/**
 * True when App ID, App Secret, and verification key are all present.
 * Privy-backed endpoints stay disabled (502) until this is true; legacy
 * JWT authentication is unaffected either way.
 */
export function isPrivyConfigured(): boolean {
  const { appId, appSecret, verificationKey } = getPrivyConfig();
  return Boolean(appId && appSecret && verificationKey);
}
