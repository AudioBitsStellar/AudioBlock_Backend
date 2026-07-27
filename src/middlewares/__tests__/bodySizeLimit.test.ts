import { isPayloadTooLargeError } from '../bodySizeLimit';

describe('isPayloadTooLargeError', () => {
  it("recognizes body-parser's entity.too.large error shape", () => {
    expect(isPayloadTooLargeError({ type: 'entity.too.large', status: 413 })).toBe(true);
  });

  it('recognizes a plain 413 status even without the type field', () => {
    expect(isPayloadTooLargeError({ status: 413 })).toBe(true);
  });

  it('returns false for an unrelated error', () => {
    expect(isPayloadTooLargeError(new Error('boom'))).toBe(false);
    expect(isPayloadTooLargeError({ type: 'entity.parse.failed', status: 400 })).toBe(false);
  });

  it('returns false for non-object values', () => {
    expect(isPayloadTooLargeError(null)).toBe(false);
    expect(isPayloadTooLargeError(undefined)).toBe(false);
    expect(isPayloadTooLargeError('error string')).toBe(false);
  });
});
