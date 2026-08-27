import { redactSensitiveFields } from '../redact';

describe('redactSensitiveFields', () => {
  it('redacts top-level sensitive fields', () => {
    const result = redactSensitiveFields({
      email: 'a@b.com',
      password: 'hunter2',
      token: 'abc.def.ghi',
    }) as Record<string, unknown>;

    expect(result.email).toBe('a@b.com');
    expect(result.password).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
  });

  it('redacts sensitive fields nested inside objects', () => {
    const result = redactSensitiveFields({
      user: { email: 'a@b.com', secret: 'topsecret' },
    }) as any;

    expect(result.user.email).toBe('a@b.com');
    expect(result.user.secret).toBe('[REDACTED]');
  });

  it('redacts sensitive fields inside arrays', () => {
    const result = redactSensitiveFields({
      accounts: [{ apiKey: 'key-1' }, { apiKey: 'key-2' }],
    }) as any;

    expect(result.accounts[0].apiKey).toBe('[REDACTED]');
    expect(result.accounts[1].apiKey).toBe('[REDACTED]');
  });

  it('matches sensitive keys case-insensitively and through separators', () => {
    const result = redactSensitiveFields({
      Password: 'a',
      REFRESH_TOKEN: 'b',
      'client-secret': 'c',
    }) as Record<string, unknown>;

    expect(result.Password).toBe('[REDACTED]');
    expect(result.REFRESH_TOKEN).toBe('[REDACTED]');
    expect(result['client-secret']).toBe('[REDACTED]');
  });

  it('handles circular references without throwing', () => {
    const obj: any = { name: 'test' };
    obj.self = obj;

    expect(() => redactSensitiveFields(obj)).not.toThrow();
    const result = redactSensitiveFields(obj) as any;
    expect(result.self).toBe('[Circular]');
  });

  it('passes through primitives and null unchanged', () => {
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields('hello')).toBe('hello');
    expect(redactSensitiveFields(42)).toBe(42);
    expect(redactSensitiveFields(undefined)).toBeUndefined();
  });
});
