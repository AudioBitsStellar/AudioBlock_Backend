/**
 * Public copyright takedown policy and DMCA designated-agent details (#986).
 *
 * The agent fields come from environment variables. They are operator-supplied
 * because the designation is made with the U.S. Copyright Office, outside this
 * codebase. The status is reported as `recorded` only when every required field
 * is configured. A missing value is never presented as a completed registration.
 */

/** Bump when the published policy text changes. */
export const TAKEDOWN_POLICY_VERSION = '1.0';

export interface DesignatedAgent {
  name: string;
  email: string;
  postalAddress: string;
  registrationNumber: string;
  /** ISO 8601 date the designation was filed, when recorded. */
  registeredAt: string | null;
}

export interface TakedownPolicy {
  policyVersion: string;
  agentRegistration: 'recorded' | 'not_recorded';
  designatedAgent: DesignatedAgent | null;
  /** Path of the endpoint that accepts takedown requests from signed-in users. */
  submitRequestPath: string;
  /** What a takedown notice must contain, following 17 U.S.C. 512(c)(3). */
  noticeRequirements: string[];
}

const NOTICE_REQUIREMENTS = [
  'Identify the copyrighted work you claim has been infringed.',
  'Identify the material on AudioBlock that you claim is infringing, with enough detail to find it (the song or URL).',
  'Provide your name, postal address, telephone number and email address.',
  'Include a statement that you have a good-faith belief the use is not authorized by the copyright owner, its agent, or the law.',
  'Include a statement, under penalty of perjury, that the information in the notice is accurate and that you are the owner or authorized to act for the owner.',
  'Sign the notice physically or electronically.',
];

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * Builds the public takedown policy from environment configuration.
 *
 * @param env - Environment to read. Defaults to process.env.
 * @returns The policy document served at `GET /api/takedown/policy`.
 */
export function getTakedownPolicy(env: NodeJS.ProcessEnv = process.env): TakedownPolicy {
  const name = clean(env.DMCA_AGENT_NAME);
  const email = clean(env.DMCA_AGENT_EMAIL);
  const postalAddress = clean(env.DMCA_AGENT_ADDRESS);
  const registrationNumber = clean(env.DMCA_AGENT_REGISTRATION_NUMBER);

  const base = {
    policyVersion: TAKEDOWN_POLICY_VERSION,
    submitRequestPath: '/api/takedown/request',
    noticeRequirements: NOTICE_REQUIREMENTS,
  };

  if (!name || !email || !postalAddress || !registrationNumber) {
    return { ...base, agentRegistration: 'not_recorded', designatedAgent: null };
  }

  return {
    ...base,
    agentRegistration: 'recorded',
    designatedAgent: {
      name,
      email,
      postalAddress,
      registrationNumber,
      registeredAt: clean(env.DMCA_AGENT_REGISTERED_AT) || null,
    },
  };
}
