#!/usr/bin/env node

const { spawnSync } = require('child_process');

const DEPLOYMENTS = {
  testnet: {
    studioSlug: process.env.GRAPH_STUDIO_TESTNET_SLUG || 'AudioBitsStellar/audioblock-testnet',
    tokenEnv: 'GRAPH_DEPLOY_TOKEN_TESTNET',
  },
  mainnet: {
    studioSlug: process.env.GRAPH_STUDIO_MAINNET_SLUG || 'AudioBitsStellar/audioblock',
    tokenEnv: 'GRAPH_DEPLOY_TOKEN_MAINNET',
  },
};

function readArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const environment = readArg('environment') || process.env.SUBGRAPH_DEPLOY_ENV || 'testnet';
const deployment = DEPLOYMENTS[environment];

if (!deployment) {
  fail(`Unsupported subgraph environment "${environment}". Use "testnet" or "mainnet".`);
}

const token =
  process.env[deployment.tokenEnv] ||
  process.env.GRAPH_DEPLOY_TOKEN ||
  process.env.GRAPH_ACCESS_TOKEN;

if (!token) {
  fail(
    `Missing deploy token. Set ${deployment.tokenEnv} or GRAPH_DEPLOY_TOKEN before deploying ${environment}.`,
  );
}

const studioSlug = readArg('studio-slug') || deployment.studioSlug;
const versionLabel = readArg('version-label') || process.env.GRAPH_VERSION_LABEL;

console.log(`Deploying AudioBlock subgraph to ${environment}: ${studioSlug}`);

const authResult = spawnSync('npx', ['graph', 'auth', '--studio', token], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (authResult.error) {
  fail(`Failed to start graph auth: ${authResult.error.message}`);
}

if (authResult.status !== 0) {
  process.exit(authResult.status ?? 1);
}

const deployArgs = ['graph', 'deploy', '--studio', studioSlug];
if (versionLabel) {
  deployArgs.push('--version-label', versionLabel);
}

const deployResult = spawnSync('npx', deployArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (deployResult.error) {
  fail(`Failed to start graph deploy: ${deployResult.error.message}`);
}

process.exit(deployResult.status ?? 1);
