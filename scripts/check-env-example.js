#!/usr/bin/env node
/**
 * Check that .env.example and src/config/env.ts stay in sync.
 *
 * Usage:
 *   node scripts/check-env-example.js           # reports mismatches, exits 1 if required var missing from .env.example
 *   node scripts/check-env-example.js --strict  # also exits 1 if .env.example documents keys no code reads
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
 * have sensible defaults and are not validated as required at startup, so
 * exact-set parity with requiredVars is NOT enforced. Instead, --strict fails
 * when .env.example documents a key that nothing in the codebase reads — i.e.
 * dead configuration that would silently drift out of sync with the docs.
 *
 * "Referenced" means the key appears as a token in non-test source under src/
 * or scripts/, or in deployment config (docker-compose, Dockerfile, workflows).
 * Keys built dynamically at runtime (e.g. SOROBAN_<NET>_<TYPE>_CONTRACT_ID)
 * are covered by DYNAMIC_ENV_PATTERNS below.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_TS = path.join(ROOT, 'src/config/env.ts');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');

// Env vars assembled at runtime (e.g. `SOROBAN_${network}_NFT_CONTRACT_ID`)
// never appear as literals, so strict mode whitelists their shapes here.
const DYNAMIC_ENV_PATTERNS = [
  /^SOROBAN_(TESTNET|MAINNET)_(NFT|ARTIST|CATALOG|ROYALTY|MARKETPLACE)_CONTRACT_ID$/,
  /^SOROBAN_(TESTNET|MAINNET)_(RPC_URL|NETWORK_PASSPHRASE)$/,
];

const CODE_SCAN_DIRS = ['src', 'scripts'];
const CODE_SCAN_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'Dockerfile', 'Dockerfile.dev'];
const CODE_SCAN_GLOBS = [/^docker-compose.*\.ya?ml$/, /^Dockerfile/, /^ecosystem.*\.js$/];
const SKIP_PATH = /(__tests__|\.test\.|\.spec\.|^tests\/|node_modules)/;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (SKIP_PATH.test(full)) continue;
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx|yml|yaml)$/.test(entry.name)) yield full;
  }
}

function collectReferencedEnvVars() {
  const tokens = new Set();
  const files = [];
  for (const dir of CODE_SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (fs.existsSync(abs)) files.push(...walk(abs));
  }
  for (const name of fs.readdirSync(ROOT)) {
    if (CODE_SCAN_GLOBS.some((re) => re.test(name)) && fs.statSync(path.join(ROOT, name)).isFile()) {
      files.push(path.join(ROOT, name));
    }
  }
  for (const file of CODE_SCAN_FILES) {
    const abs = path.join(ROOT, file);
    if (fs.existsSync(abs)) files.push(abs);
  }
  const tokenRe = /\b[A-Z][A-Z0-9_]{2,}\b/g;
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = tokenRe.exec(content)) !== null) tokens.add(m[0]);
  }
  return tokens;
}

function isReferenced(key, referenced) {
  return referenced.has(key) || DYNAMIC_ENV_PATTERNS.some((re) => re.test(key));
}

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
  const referenced = collectReferencedEnvVars();
  const unreferencedInExample = extraInExample.filter((k) => !isReferenced(k, referenced));

  const ok =
    missingInExample.length === 0 && (!strict || unreferencedInExample.length === 0);

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
          unreferencedInExample,
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
    const level = strict && unreferencedInExample.length ? '❌' : '⚠';
    console.log(
      `${level} Extra in .env.example (${extraInExample.length}): documented but not in requiredVars`,
    );
    extraInExample.forEach((k) => console.log(`   - ${k}`));
    if (strict) {
      if (unreferencedInExample.length) {
        console.log(
          `   Strict mode: ${unreferencedInExample.length} key(s) are not read by any code — dead config.`,
        );
        unreferencedInExample.forEach((k) => console.log(`   - ${k}`));
        console.log('   Fix: remove the key from .env.example (and docs/environment-variables.md), or wire it up in code.');
      } else {
        console.log('   Strict mode: all extra keys are referenced by the codebase. ✅');
      }
    } else {
      console.log('   This is informational — .env.example is allowed to document optional vars with defaults.');
      console.log('   If any of these should be required at startup, add them to requiredVars in src/config/env.ts.');
      console.log('   Run with --strict to fail on keys that no code reads.');
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
    if (strict && unreferencedInExample.length) {
      console.log(`❌ Env sync failed (strict): ${unreferencedInExample.length} key(s) in .env.example are not read by any code`);
    }
    process.exit(1);
  }
}

main();
