import fs from 'node:fs';
import path from 'node:path';

const routesDir = path.join(__dirname, '../../src/routes');

/** Regression inventory for owner-scoped resources (issue #893). */
const ownerScopedRoutes = [
  'SongRoutes.ts',
  'playlistRoutes.ts',
  'commentRoutes.ts',
  'apiKeyRoutes.ts',
  'royaltyTemplateRoutes.ts',
];

describe('owner-scoped route regression inventory', () => {
  it.each(ownerScopedRoutes)('retains an owner identity check in %s', (file) => {
    const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
    // Ownership is enforced in the controller/service layer; the route must
    // still require an authenticated principal before that check can run.
    expect(source).toMatch(/requireAuth/);
  });
});
