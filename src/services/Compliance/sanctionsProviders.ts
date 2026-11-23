/**
 * Sanctions screening providers (#985).
 *
 * A provider answers one question: does this payout recipient match a sanctions
 * list? The payout gate in SanctionsScreeningService calls a provider before any
 * royalty payout is recorded. Providers are pluggable so a licensed screening
 * vendor can replace the local denylist without touching the payout code.
 */

export interface ScreeningSubject {
  /** Stellar G... public key of the payout recipient. */
  stellarPublicKey: string;
}

export type ScreeningOutcome = { status: 'clear' } | { status: 'match'; reference: string };

export interface SanctionsScreeningProvider {
  readonly name: string;

  /**
   * Screen one recipient. Implementations must throw when the screen cannot be
   * completed. The caller fails closed, so a failure is never treated as "clear".
   */
  screen(subject: ScreeningSubject): Promise<ScreeningOutcome>;
}

/**
 * Matches recipient public keys against a locally configured list
 * (`SANCTIONS_DENYLIST`). This is the only provider shipped in the repository.
 * It is a stopgap until a screening vendor is chosen.
 */
export class DenylistScreeningProvider implements SanctionsScreeningProvider {
  readonly name = 'denylist';
  private readonly deniedKeys: Set<string>;

  constructor(publicKeys: string[]) {
    this.deniedKeys = new Set(publicKeys.map((key) => key.trim()).filter((key) => key.length > 0));
  }

  async screen(subject: ScreeningSubject): Promise<ScreeningOutcome> {
    if (this.deniedKeys.has(subject.stellarPublicKey)) {
      return { status: 'match', reference: 'denylist' };
    }
    return { status: 'clear' };
  }
}

/**
 * Builds the provider named by `SANCTIONS_SCREENING_PROVIDER` (default `denylist`).
 * An unrecognised value throws. The payout gate turns that into a fail-closed
 * error rather than silently running without screening.
 */
export function createScreeningProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SanctionsScreeningProvider {
  const name = (env.SANCTIONS_SCREENING_PROVIDER || 'denylist').trim().toLowerCase();

  if (name === 'denylist') {
    return new DenylistScreeningProvider((env.SANCTIONS_DENYLIST || '').split(','));
  }

  throw new Error(`Unsupported SANCTIONS_SCREENING_PROVIDER: ${name}`);
}
