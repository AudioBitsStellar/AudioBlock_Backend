import { routeParam } from '../routeParams';

describe('routeParam', () => {
  it('returns the string value as-is', () => {
    expect(routeParam('abc-123')).toBe('abc-123');
  });

  it('returns a valid UUID string unchanged', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(routeParam(uuid)).toBe(uuid);
  });

  it('returns empty string when value is undefined', () => {
    expect(routeParam(undefined)).toBe('');
  });

  it('returns first element when Express supplies an array', () => {
    expect(routeParam(['first', 'second'])).toBe('first');
  });

  it('returns empty string when Express supplies an empty array', () => {
    expect(routeParam([])).toBe('');
  });

  it('handles numeric-string params', () => {
    expect(routeParam('42')).toBe('42');
  });

  it('handles a single-element array', () => {
    expect(routeParam(['only'])).toBe('only');
  });

  it('returns empty string for empty string input', () => {
    expect(routeParam('')).toBe('');
  });
});
