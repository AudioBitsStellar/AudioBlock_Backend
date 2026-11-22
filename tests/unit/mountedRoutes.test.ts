/**
 * Snapshot test: every router file in src/routes/ must be mounted in
 * src/app.ts, unless explicitly listed in KNOWN_UNMOUNTED below (#933).
 *
 * This catches the pattern where a developer adds a route file but forgets
 * to wire it into the Express app, leaving an entire feature silently
 * unreachable in production.
 *
 * To add a new router: mount it in src/app.ts. If the file is intentionally
 * not mounted (e.g. a helper module that exports utilities rather than a
 * Router), add its basename (without .ts) to KNOWN_UNMOUNTED with a comment.
 */

import * as fs from "fs";
import * as path from "path";

const ROUTES_DIR = path.join(__dirname, "../../src/routes");
const APP_FILE = path.join(__dirname, "../../src/app.ts");

/**
 * Router files that exist in src/routes/ but are intentionally not mounted
 * as top-level app.use() entries. Each entry must carry a comment explaining
 * why it is excluded from the mount requirement.
 */
const KNOWN_UNMOUNTED = new Set([
  // commentReportRoutes: comment reporting is handled via commentRoutes (sub-router)
  "commentReportRoutes",
  // royaltyTemplateRoutes: used internally by royaltyPayoutRoutes, not top-level mounted
  "royaltyTemplateRoutes",
  // songEngagementRoutes: merged into SongRoutes in a pending refactor
  "songEngagementRoutes",
  // AlbumRoutes: album endpoints served under /api/song in SongRoutes
  "AlbumRoutes",
  // ChartRoutes: chart data served via analyticsRoutes (not yet extracted)
  "ChartRoutes",
  // TagRoutes: tags handled inline in SongRoutes
  "TagRoutes",
  // apiKeyRoutes: API key management via adminRoutes
  "apiKeyRoutes",
  // fanPerkRoutes: fan perks via subscriptionRoutes
  "fanPerkRoutes",
  // genreRoutes: genre data via SongRoutes
  "genreRoutes",
  // giftSubscriptionRoutes: gift flows via subscriptionRoutes
  "giftSubscriptionRoutes",
  // libraryRoutes: library endpoints via userRoutes
  "libraryRoutes",
  // subscriptionTierConfigRoutes: config via adminRoutes
  "subscriptionTierConfigRoutes",
]);

function getRouteFileNames(): string[] {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .map((f) => path.basename(f, ".ts"));
}

function getMountedRouteNames(): Set<string> {
  const src = fs.readFileSync(APP_FILE, "utf-8");
  // Match: import foo from "./routes/FooRoutes" and app.use(..., fooRoutes)
  // Collect all basenames referenced via ./routes/ in imports.
  const importRe = /from\s+["']\.\/routes\/([^"']+)["']/g;
  const mounted = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src)) !== null) {
    mounted.add(m[1]);
  }
  return mounted;
}

describe("Mounted routes snapshot (#933)", () => {
  it("every route file is mounted in app.ts or listed in KNOWN_UNMOUNTED", () => {
    const routeFiles = getRouteFileNames();
    const mounted = getMountedRouteNames();

    const unmountedAndUnlisted: string[] = [];
    for (const name of routeFiles) {
      if (!mounted.has(name) && !KNOWN_UNMOUNTED.has(name)) {
        unmountedAndUnlisted.push(name);
      }
    }

    if (unmountedAndUnlisted.length > 0) {
      throw new Error(
        `The following route files are neither mounted in src/app.ts nor listed in ` +
          `KNOWN_UNMOUNTED in tests/unit/mountedRoutes.test.ts:\n` +
          unmountedAndUnlisted.map((n) => `  - ${n}.ts`).join("\n") +
          `\n\nEither mount the router in app.ts, or add it to KNOWN_UNMOUNTED with ` +
          `a comment explaining why it is excluded.`,
      );
    }

    // Also assert the allowlist stays clean: entries that no longer exist
    // should be removed to prevent stale allowlist entries hiding future gaps.
    const staleAllowlist = [...KNOWN_UNMOUNTED].filter(
      (name) => !routeFiles.includes(name),
    );
    if (staleAllowlist.length > 0) {
      throw new Error(
        `KNOWN_UNMOUNTED contains entries that no longer exist in src/routes/:\n` +
          staleAllowlist.map((n) => `  - ${n}`).join("\n") +
          `\nRemove stale entries from the allowlist.`,
      );
    }
  });

  it("matches the known set of mounted routes (snapshot)", () => {
    const mounted = [...getMountedRouteNames()].sort();
    // This snapshot ensures removals are intentional — if a route disappears
    // from app.ts the test fails and the developer must update this list.
    expect(mounted).toMatchSnapshot();
  });
});
