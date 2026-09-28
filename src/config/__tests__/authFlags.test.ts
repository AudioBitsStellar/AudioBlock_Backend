import {
  checkAuthFlagConfig,
  getAuthMode,
  isLegacyAuthEnabled,
  isLegacyFallbackEnabled,
  isPrivyAuthEnabled,
  isPrivyConfigured,
  listAuthFlags,
} from '../authFlags';

const FLAGS = ['AUTH_MODE', 'PRIVY_APP_ID', 'PRIVY_ALLOW_LEGACY_FALLBACK'] as const;

describe('authFlags', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of FLAGS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of FLAGS) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  describe('getAuthMode', () => {
    it('defaults to legacy when unset, so an unconfigured deploy behaves as before', () => {
      expect(getAuthMode()).toBe('legacy');
    });

    it.each(['legacy', 'privy', 'both'])('accepts the mode %p', (mode) => {
      process.env.AUTH_MODE = mode;
      expect(getAuthMode()).toBe(mode);
    });

    it('normalises case and surrounding whitespace', () => {
      process.env.AUTH_MODE = '  BOTH ';
      expect(getAuthMode()).toBe('both');
    });

    it.each(['yes', 'enabled', '1', 'true', ''])(
      'falls back to legacy for the unrecognised value %p',
      (value) => {
        // Fails safe: a typo must not silently disable one of the two auth paths.
        process.env.AUTH_MODE = value;
        expect(getAuthMode()).toBe('legacy');
      },
    );
  });

  describe('mode → enabled paths', () => {
    it('legacy mode enables only the legacy path', () => {
      process.env.AUTH_MODE = 'legacy';
      expect(isLegacyAuthEnabled()).toBe(true);
      expect(isPrivyAuthEnabled()).toBe(false);
    });

    it('both mode enables both paths, for a staged rollout', () => {
      process.env.AUTH_MODE = 'both';
      expect(isLegacyAuthEnabled()).toBe(true);
      expect(isPrivyAuthEnabled()).toBe(true);
    });

    it('privy mode disables the legacy path', () => {
      process.env.AUTH_MODE = 'privy';
      expect(isLegacyAuthEnabled()).toBe(false);
      expect(isPrivyAuthEnabled()).toBe(true);
    });

    it('never disables both paths at once', () => {
      for (const mode of ['legacy', 'privy', 'both'] as const) {
        process.env.AUTH_MODE = mode;
        expect(isLegacyAuthEnabled() || isPrivyAuthEnabled()).toBe(true);
      }
    });
  });

  describe('isLegacyFallbackEnabled', () => {
    it('defaults to on, so a Privy outage does not lock everyone out', () => {
      expect(isLegacyFallbackEnabled()).toBe(true);
    });

    it('can be turned off explicitly', () => {
      process.env.PRIVY_ALLOW_LEGACY_FALLBACK = 'false';
      expect(isLegacyFallbackEnabled()).toBe(false);
    });

    it('fails closed on a malformed value', () => {
      process.env.PRIVY_ALLOW_LEGACY_FALLBACK = 'maybe';
      expect(isLegacyFallbackEnabled()).toBe(false);
    });
  });

  describe('isPrivyConfigured', () => {
    it('is false without an app id', () => {
      expect(isPrivyConfigured()).toBe(false);
    });

    it('is true with an app id', () => {
      process.env.PRIVY_APP_ID = 'abc123';
      expect(isPrivyConfigured()).toBe(true);
    });

    it('ignores a whitespace-only app id', () => {
      process.env.PRIVY_APP_ID = '   ';
      expect(isPrivyConfigured()).toBe(false);
    });
  });

  describe('checkAuthFlagConfig', () => {
    it('passes for the default configuration', () => {
      expect(checkAuthFlagConfig()).toBeNull();
    });

    it('passes when Privy is enabled and configured', () => {
      process.env.AUTH_MODE = 'privy';
      process.env.PRIVY_APP_ID = 'abc123';
      expect(checkAuthFlagConfig()).toBeNull();
    });

    it('rejects "privy" mode with no app id, which would 401 every request', () => {
      // Better to refuse to boot than to run a server that rejects all logins
      // with a puzzling 401 that looks like a client bug.
      process.env.AUTH_MODE = 'privy';
      expect(checkAuthFlagConfig()).toMatch(/PRIVY_APP_ID/);
    });

    it('rejects "both" mode with no app id', () => {
      process.env.AUTH_MODE = 'both';
      expect(checkAuthFlagConfig()).toMatch(/PRIVY_APP_ID/);
    });
  });

  describe('listAuthFlags', () => {
    it('reports the resolved state of every flag', () => {
      process.env.AUTH_MODE = 'both';
      process.env.PRIVY_APP_ID = 'abc123';
      process.env.PRIVY_ALLOW_LEGACY_FALLBACK = 'false';

      expect(listAuthFlags()).toEqual({
        mode: 'both',
        privyEnabled: true,
        legacyEnabled: true,
        legacyFallbackEnabled: false,
        privyConfigured: true,
      });
    });

    it('reflects the fail-safe default on a bare deployment', () => {
      expect(listAuthFlags()).toEqual({
        mode: 'legacy',
        privyEnabled: false,
        legacyEnabled: true,
        legacyFallbackEnabled: true,
        privyConfigured: false,
      });
    });
  });
});
