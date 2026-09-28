#!/usr/bin/env node
/**
 * scripts/deploy-hosted.js
 *
 * Issue #660 – Write deployment script for subgraph to hosted service.
 *
 * Deploys the AudioBlock subgraph to The Graph's hosted service
 * (https://api.thegraph.com/deploy/).  This is the legacy "hosted service"
 * endpoint, distinct from the decentralised Subgraph Studio endpoint used
 * by scripts/deploy.js.
 *
 * Usage:
 *   node scripts/deploy-hosted.js [options]
 *
 *   --subgraph <slug>      Hosted-service subgraph slug, e.g. "AudioBitsStellar/audioblock".
 *                          Falls back to GRAPH_HOSTED_SUBGRAPH env var, then the default below.
 *   --version-label <str>  Human-readable version label (e.g. "v1.2.3").
 *                          Falls back to GRAPH_VERSION_LABEL, then a git-hash prefix.
 *   --skip-build           Skip codegen + build steps (use if already built).
 *   --dry-run              Print the commands that would run without executing them.
 *
 * Required environment variables:
 *   GRAPH_ACCESS_TOKEN     The Graph hosted-service access token.
 *                          Generate one at https://thegraph.com/hosted-service/dashboard.
 */

'use strict';

const { spawnSync, execSync } = require('child_process');
const path = require('path');

// ---- helpers ---------------------------------------------------------------

function readArg(name) {
  const prefix = `--${name}=`;
  const inlineIdx = process.argv.findIndex((a) => a.startsWith(prefix));
  if (inlineIdx !== -1) return process.argv[inlineIdx].slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function fail(message) {
  console.error(`[deploy-hosted] ERROR: ${message}`);
  process.exit(1);
}

function run(cmd, args, { dryRun = false } = {}) {
  const full = `${cmd} ${args.join(' ')}`;
  if (dryRun) {
    console.log(`[dry-run] ${full}`);
    return 0;
  }
  console.log(`[deploy-hosted] Running: ${full}`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: path.resolve(__dirname, '..'),
  });
  if (result.error) fail(`Failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`Command exited with status ${result.status}`);
  }
  return result.status;
}

// ---- configuration ---------------------------------------------------------

const DEFAULT_SUBGRAPH = 'AudioBitsStellar/audioblock';
const HOSTED_NODE = 'https://api.thegraph.com/deploy/';
const HOSTED_IPFS = 'https://api.thegraph.com/ipfs/';

const subgraph =
  readArg('subgraph') || process.env.GRAPH_HOSTED_SUBGRAPH || DEFAULT_SUBGRAPH;

const accessToken = process.env.GRAPH_ACCESS_TOKEN;
if (!accessToken) {
  fail(
    'Missing GRAPH_ACCESS_TOKEN. Export your The Graph hosted-service access token before running this script.\n' +
      '  Tokens can be generated at https://thegraph.com/hosted-service/dashboard\n',
  );
}

const skipBuild = hasFlag('skip-build');
const dryRun = hasFlag('dry-run');

// Derive a version label: explicit arg > env var > short git hash > timestamp
let versionLabel = readArg('version-label') || process.env.GRAPH_VERSION_LABEL;
if (!versionLabel) {
  try {
    versionLabel = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    versionLabel = `deploy-${Date.now()}`;
  }
}

// ---- main ------------------------------------------------------------------

console.log('');
console.log('AudioBlock – Subgraph Hosted Service Deployment');
console.log('─────────────────────────────────────────────────');
console.log(`  Subgraph slug : ${subgraph}`);
console.log(`  Version label : ${versionLabel}`);
console.log(`  Skip build    : ${skipBuild}`);
console.log(`  Dry run       : ${dryRun}`);
console.log('');

// 1. Codegen (unless --skip-build)
if (!skipBuild) {
  console.log('[deploy-hosted] Step 1/3 – Running codegen …');
  run('npx', ['graph', 'codegen'], { dryRun });

  // 2. Build
  console.log('[deploy-hosted] Step 2/3 – Building subgraph …');
  run('npx', ['graph', 'build'], { dryRun });
} else {
  console.log('[deploy-hosted] Skipping codegen + build (--skip-build)');
}

// 3. Authenticate then deploy to hosted service
console.log('[deploy-hosted] Step 3/3 – Deploying to The Graph hosted service …');

// Authenticate
run('npx', ['graph', 'auth', '--product', 'hosted-service', accessToken], { dryRun });

// Deploy
const deployArgs = [
  'graph',
  'deploy',
  '--product',
  'hosted-service',
  '--node',
  HOSTED_NODE,
  '--ipfs',
  HOSTED_IPFS,
  '--version-label',
  versionLabel,
  subgraph,
];

run('npx', deployArgs, { dryRun });

console.log('');
console.log(`[deploy-hosted] ✓ Deployment complete: https://thegraph.com/hosted-service/subgraph/${subgraph}`);
