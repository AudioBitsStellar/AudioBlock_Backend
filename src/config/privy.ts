import { Router } from 'express';
import { validateEnvironment } from './env';

const env = validateEnvironment();

export const isPrivyEnabled = Boolean(env.PRIVY_APP_ID && env.PRIVY_APP_SECRET);

export const privyAuthEndpoints = [
  '/api/auth/privy/login',
  '/api/auth/privy/verify',
  '/api/auth/privy/refresh-token',
  '/api/auth/privy/logout',
];

export const privyConfig = {
  appId: env.PRIVY_APP_ID,
  appSecret: env.PRIVY_APP_SECRET,
  verificationKey: env.PRIVY_VERIFICATION_KEY,
};

export function applyPrivyCorsToRouter(router: Router, corsOptions: any): void {
  if (!isPrivyEnabled) return;

  const privyEndpoints = [
    '/privy/login',
    '/privy/verify',
    '/privy/refresh-token',
    '/privy/logout',
  ];

  privyEndpoints.forEach((endpoint) => {
    router.options(endpoint, (req, res) => {
      res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Privy-ID-Token');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.sendStatus(200);
    });
  });
}
