#!/usr/bin/env node
/**
 * Check that .env.example and src/config/env.ts stay in sync.
 *
 * Usage:
 *   node scripts/check-env-example.js           # reports mismatches, exits 1 if required var missing from .env.example
 *   node scripts/check-env-example.js --strict  # also exits 1 if .env.example contains extra keys not in required list
 *   node scripts/check-env-example.js --json    # machine-readable output
 *
 * Source of truth for "required" is the `requiredVars` array in src/config/env.ts
 * (e.g. POSTGRES_HOST, JWT_SECRET, ...). The script diffs that list against the
 * active (uncommented) keys in .env.example.
 *
 * Two directions are reported:
 *   - missingInExample: required var not present in .env.example  (always an error)
 *   - extraInExample:   key present in .env.example but not in required list
 *                       (reported as informational unless --strict is set)
 *
 * Rationale: .env.example is intentionally a superset of requiredVars — it
 * documents optional tuning vars (REDIS_HOST, LOG_LEVEL, rate limits, etc.) that
 * have sensible defaults and are not validated as required at startup. Treating
 * every extra key as a hard error would force callers to either trim useful
 * documentation or bloat the required set. Therefore the default mode warns on
 * extras but only fails on truly missing required keys. Pass --strict in CI if
 * you want exact-set parity (e.g. for a dedicated "required-only" example file).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_TS = path.join(ROOT, 'src/config/env.ts');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');

function parseRequiredVars() {
  if (!fs.existsSync(ENV_TS)) {
    throw new Error(`Missing file: src/config/env.ts (looked at ${ENV_TS})`);
  }
  const content = fs.readFileSync(ENV_TS, 'utf8');
  // Match const requiredVars: (...)[] = [ 'FOO', 'BAR', ... ];
  const arrayMatch = content.match(/const\s+requiredVars[^=]*=\s*\[([\s\S]*?)\]/m);
  if (!arrayMatch) {
    throw new Error('Could not find `requiredVars` array in src/config/env.ts');
  }
  const inside = arrayMatch[1];
  const vars = [];
  const regex = /['"]([A-Z][A-Z0-9_]+)['"]/g;
  let m;
  while ((m = regex.exec(inside)) !== null) {
    vars.push(m[1]);
  }
  if (vars.length === 0) {
    throw new Error('Parsed 0 required vars from src/config/env.ts — regex may be out of date');
  }
  return [...new Set(vars)].sort();
}

function parseEnvExample() {
  if (!fs.existsSync(ENV_EXAMPLE)) {
    throw new Error(`Missing file: .env.example (looked at ${ENV_EXAMPLE})`);
  }
  const lines = fs.readFileSync(ENV_EXAMPLE, 'utf8').split('\n');
  const keys = [];
  const commentedKeys = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Commented example overrides like "# SOROBAN_TESTNET_RPC_URL=" — track separately for info
    if (line.startsWith('#')) {
      const maybeKey = line.replace(/^#\s*/, '').split('=')[0].trim();
      if (/^[A-Z][A-Z0-9_]+$/.test(maybeKey)) {
        commentedKeys.push(maybeKey);
      }
      continue;
    }
    // Active line: KEY=... (ignore inline comments after value)
    if (!line.includes('=')) continue;
    const key = line.split('=')[0].trim();
    if (/^[A-Z][A-Z0-9_]+$/.test(key)) {
      keys.push(key);
    }
  }
  return {
    active: [...new Set(keys)].sort(),
    commented: [...new Set(commentedKeys)].sort(),
  };
}

function main() {
  const asJson = process.argv.includes('--json');
  const strict = process.argv.includes('--strict');

  let required;
  let example;
  try {
    required = parseRequiredVars();
    example = parseEnvExample();
  } catch (err) {
    const msg = err.message;
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.error(`❌ ${msg}`);
    }
    process.exit(1);
  }

  const exampleActiveSet = new Set(example.active);
  const requiredSet = new Set(required);

  const missingInExample = required.filter((k) => !exampleActiveSet.has(k));
  const extraInExample = example.active.filter((k) => !requiredSet.has(k));

  const ok = missingInExample.length === 0 && (!strict || extraInExample.length === 0);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok,
          strict,
          requiredVars: required,
          envExampleActiveKeys: example.active,
          envExampleCommentedKeys: example.commented,
          missingInExample,
          extraInExample,
        },
        null,
        2,
      ),
    );
    process.exit(ok ? 0 : 1);
  }

  console.log('Env sync check: src/config/env.ts ↔ .env.example');
  console.log('=================================================');
  console.log(`Required vars (src/config/env.ts): ${required.length}`);
  console.log(`  ${required.join(', ')}`);
  console.log(`Active keys (.env.example): ${example.active.length}`);
  console.log(`  ${example.active.join(', ')}`);
  if (example.commented.length) {
    console.log(`Commented example keys (ignored, optional overrides): ${example.commented.length}`);
    console.log(`  ${example.commented.join(', ')}`);
  }
  console.log('');

  if (missingInExample.length) {
    console.log(`❌ Missing in .env.example (${missingInExample.length}): required var not documented`);
    missingInExample.forEach((k) => console.log(`   - ${k}`));
    console.log('   Fix: add the key to .env.example (or remove it from requiredVars if it is truly optional).');
    console.log('');
  } else {
    console.log('✅ All required vars are present in .env.example');
    console.log('');
  }

  if (extraInExample.length) {
    const level = strict ? '❌' : '⚠';
    console.log(
      `${level} Extra in .env.example (${extraInExample.length}): documented but not in requiredVars`,
    );
    extraInExample.forEach((k) => console.log(`   - ${k}`));
    if (strict) {
      console.log('   Strict mode: this is an error. Either add the key to requiredVars or remove it from .env.example.');
    } else {
      console.log('   This is informational — .env.example is allowed to document optional vars with defaults.');
      console.log('   If any of these should be required at startup, add them to requiredVars in src/config/env.ts.');
      console.log('   Run with --strict to enforce exact parity.');
    }
    console.log('');
  } else {
    console.log('✅ No extra keys in .env.example beyond requiredVars');
    console.log('');
  }

  if (ok) {
    console.log('✅ Env sync check passed');
    process.exit(0);
  } else {
    if (missingInExample.length) {
      console.log(`❌ Env sync failed: ${missingInExample.length} required var(s) missing from .env.example`);
    }
    if (strict && extraInExample.length) {
      console.log(`❌ Env sync failed (strict): ${extraInExample.length} extra key(s) in .env.example`);
    }
    process.exit(1);
  }
}

main();
