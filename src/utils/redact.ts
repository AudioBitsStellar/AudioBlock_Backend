/**
 * Redacts sensitive fields from an object before it's written to logs.
 * Used to log request bodies at debug level without leaking credentials.
 */

const SENSITIVE_FIELD_NAMES = new Set([
  'password',
  'newpassword',
  'oldpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'apikey',
  'secret',
  'jwtsecret',
  'clientsecret',
  'privatekey',
  'twofactorsecret',
  'totpsecret',
  'creditcard',
  'cardnumber',
  'cvv',
  'ssn',
]);

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_FIELD_NAMES.has(key.toLowerCase().replace(/[_-]/g, ''));
}

/**
 * Deep-clones `value`, replacing any property whose key matches a known
 * sensitive field name with a fixed redaction marker. Safe against circular
 * references and depth-limited so a pathological payload can't hang logging.
 */
export function redactSensitiveFields(value: unknown, depth = 0, seen = new WeakSet()): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return '[Truncated]';
  }

  if (seen.has(value as object)) {
    return '[Circular]';
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item, depth + 1, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactSensitiveFields(val, depth + 1, seen);
  }
  return result;
}
