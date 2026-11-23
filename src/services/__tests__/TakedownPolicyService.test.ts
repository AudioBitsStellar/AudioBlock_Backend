import { getTakedownPolicy, TAKEDOWN_POLICY_VERSION } from '../TakedownPolicyService';

const FULL_ENV = {
  DMCA_AGENT_NAME: 'Jane Agent',
  DMCA_AGENT_EMAIL: 'dmca@example.org',
  DMCA_AGENT_ADDRESS: '1 Example Way, Lagos',
  DMCA_AGENT_REGISTRATION_NUMBER: 'TEST-REG-0001',
  DMCA_AGENT_REGISTERED_AT: '2026-11-01',
} as NodeJS.ProcessEnv;

describe('getTakedownPolicy (#986)', () => {
  it('reports the agent as recorded only when every required field is configured', () => {
    const policy = getTakedownPolicy(FULL_ENV);

    expect(policy.agentRegistration).toBe('recorded');
    expect(policy.designatedAgent).toEqual({
      name: 'Jane Agent',
      email: 'dmca@example.org',
      postalAddress: '1 Example Way, Lagos',
      registrationNumber: 'TEST-REG-0001',
      registeredAt: '2026-11-01',
    });
  });

  it.each([
    'DMCA_AGENT_NAME',
    'DMCA_AGENT_EMAIL',
    'DMCA_AGENT_ADDRESS',
    'DMCA_AGENT_REGISTRATION_NUMBER',
  ])('does not claim registration when %s is missing', (key) => {
    const env = { ...FULL_ENV, [key]: '' } as NodeJS.ProcessEnv;

    const policy = getTakedownPolicy(env);

    expect(policy.agentRegistration).toBe('not_recorded');
    expect(policy.designatedAgent).toBeNull();
  });

  it('treats whitespace-only values as missing', () => {
    const env = { ...FULL_ENV, DMCA_AGENT_EMAIL: '   ' } as NodeJS.ProcessEnv;

    expect(getTakedownPolicy(env).agentRegistration).toBe('not_recorded');
  });

  it('trims configured values', () => {
    const env = { ...FULL_ENV, DMCA_AGENT_NAME: '  Jane Agent  ' } as NodeJS.ProcessEnv;

    expect(getTakedownPolicy(env).designatedAgent?.name).toBe('Jane Agent');
  });

  it('leaves registeredAt null when the date is not configured', () => {
    const env = { ...FULL_ENV, DMCA_AGENT_REGISTERED_AT: undefined } as NodeJS.ProcessEnv;

    expect(getTakedownPolicy(env).designatedAgent?.registeredAt).toBeNull();
  });

  it('always publishes the version, submission path and notice requirements', () => {
    const policy = getTakedownPolicy({} as NodeJS.ProcessEnv);

    expect(policy.policyVersion).toBe(TAKEDOWN_POLICY_VERSION);
    expect(policy.submitRequestPath).toBe('/api/takedown/request');
    expect(policy.noticeRequirements.length).toBeGreaterThan(0);
  });
});
