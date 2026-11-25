import fs from 'node:fs';
import path from 'node:path';

const routesDir = path.join(__dirname, '../../src/routes');

/**
 * Keep the security boundary explicit when a route is added or moved. Public
 * routes are intentionally omitted; every route in this matrix must retain an
 * authentication middleware reference in its router module.
 */
const protectedRoutes = [
  'SongRoutes.ts',
  'playlistRoutes.ts',
  'commentRoutes.ts',
  'webhookRoutes.ts',
  'apiKeyRoutes.ts',
  'royaltyTemplateRoutes.ts',
];

describe('route authorization matrix', () => {
  it.each(protectedRoutes)('keeps %s behind authentication', (file) => {
    const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
    expect(source).toMatch(/requireAuth|authenticate|authMiddleware/);
  });
});
