/**
 * Historical backfill CLI (Issues #235, #681) — `npm run cli:reindex -- backfill ...`
 *
 * Commands:
 *   backfill:run    <--contract> <--network> <--start> <--end> [--batch-size] [--type]
 *   backfill:auto   <--contract> <--network> [--batch-size] [--type]
 *   backfill:status <--contract> <--network>
 *
 * backfill:auto discovers the deployment block automatically and backfills from there.
 *
 * See docs/indexer-backfill-runbook.md for the full workflow.
 */
import 'reflect-metadata';
import AppDataSource from '../config/db';
import { BackfillService } from '../services/Soroban/BackfillService';
import { BackfillEnhancementService } from '../services/Soroban/BackfillEnhancementService';
import { ContractType } from '../services/Soroban/eventDecoders';
import { SorobanEventReader } from '../services/Soroban/SorobanEventReader';
import logger from '../config/logger';

const ALLOWED_TYPES: ContractType[] = ['nft', 'artist', 'catalog', 'royalty', 'marketplace'];

interface CliArgs {
  command: string;
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): CliArgs {
  const command = argv[0] ?? '';
  const flags = new Map<string, string>();
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      flags.set(key, value ?? '');
    }
  }
  return { command, flags };
}

function requireFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }
  return value;
}

async function runBackfill(flags: Map<string, string>): Promise<void> {
  const contractId = requireFlag(flags, 'contract');
  const network = requireFlag(flags, 'network');
  const start = Number(requireFlag(flags, 'start'));
  const end = Number(requireFlag(flags, 'end'));
  const batchSize = flags.get('batch-size') ? Number(flags.get('batch-size')) : 200;
  const contractType = (flags.get('type') as ContractType) ?? 'nft';

  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error('--start and --end must be numeric ledger sequences');
  }
  if (start > end) {
    throw new Error('--start must be <= --end');
  }
  if (!ALLOWED_TYPES.includes(contractType)) {
    throw new Error(`--type must be one of: ${ALLOWED_TYPES.join(', ')}`);
  }

  logger.info('Running historical backfill...');
  const service = new BackfillService();
  const result = await service.run({
    contractId,
    network,
    startLedger: start,
    endLedger: end,
    batchSize,
    contractType,
  });

  console.log('\nBackfill complete:');
  console.log(`  Contract:      ${result.contractId}`);
  console.log(`  Network:       ${result.network}`);
  console.log(`  Ledger Range:  ${result.startLedger}-${result.endLedger}`);
  console.log(`  Events Imported: ${result.eventsImported.toLocaleString()}`);
}

async function runAutoBackfill(flags: Map<string, string>): Promise<void> {
  const contractId = requireFlag(flags, 'contract');
  const network = requireFlag(flags, 'network');
  const batchSize = flags.get('batch-size') ? Number(flags.get('batch-size')) : 200;
  const contractType = (flags.get('type') as ContractType) ?? 'nft';

  if (!ALLOWED_TYPES.includes(contractType)) {
    throw new Error(`--type must be one of: ${ALLOWED_TYPES.join(', ')}`);
  }

  logger.info(`Auto-discovering deployment ledger for ${contractId} on ${network}...`);

  const enhancementService = new BackfillEnhancementService();
  const deploymentLedger = await enhancementService.discoverDeploymentLedger(contractId, network);

  const reader = new SorobanEventReader();
  const latestLedger = await reader.getLatestLedger();
  const endLedger = latestLedger.sequence;

  console.log(`\nDiscovered deployment details:`);
  console.log(`  Deployment Ledger: ${deploymentLedger}`);
  console.log(`  Current Ledger:    ${endLedger}`);
  console.log(`  Ledgers to scan:   ${endLedger - deploymentLedger + 1}`);

  const confirm = process.env.SKIP_CONFIRMATION === 'true' ? 'yes' : 'unknown';
  if (confirm !== 'yes') {
    console.log('\nTo proceed with backfill, run with SKIP_CONFIRMATION=true or use backfill:run directly.');
    return;
  }

  logger.info(`Running auto-backfill from ledger ${deploymentLedger} to ${endLedger}...`);
  const service = new BackfillService();
  const result = await service.run({
    contractId,
    network,
    startLedger: deploymentLedger,
    endLedger,
    batchSize,
    contractType,
  });

  console.log('\nBackfill complete:');
  console.log(`  Contract:        ${result.contractId}`);
  console.log(`  Network:         ${result.network}`);
  console.log(`  Ledger Range:    ${result.startLedger}-${result.endLedger}`);
  console.log(`  Events Imported: ${result.eventsImported.toLocaleString()}`);
}

async function printStatus(flags: Map<string, string>): Promise<void> {
  const contractId = requireFlag(flags, 'contract');
  const network = requireFlag(flags, 'network');

  const service = new BackfillService();
  const status = await service.status(contractId, network);

  if (!status) {
    console.log(`No backfill record found for ${contractId} on ${network}`);
    return;
  }

  console.log(status.completed ? 'Backfill completed:' : 'Backfill in progress:');
  console.log(`  Contract:         ${contractId}`);
  console.log(`  Network:          ${network}`);
  console.log(`  Ledger Range:     ${status.startLedger ?? 'N/A'}-${status.endLedger ?? 'N/A'}`);
  console.log(`  Events Imported:  ${status.eventsImported.toLocaleString()}`);
  console.log(`  Cursor Ledger:    ${status.cursorLedger ?? 'N/A'}`);
  if (status.errorMessage) console.log(`  Last Error:       ${status.errorMessage}`);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  await AppDataSource.initialize();

  switch (command) {
    case 'backfill:run':
      await runBackfill(flags);
      break;
    case 'backfill:auto':
      await runAutoBackfill(flags);
      break;
    case 'backfill:status':
      await printStatus(flags);
      break;
    default:
      console.log('Usage:');
      console.log(
        '  npm run cli:reindex -- backfill:run    --contract <ID> --network <NET> --start <L> --end <L> [--batch-size N] [--type T]',
      );
      console.log('  npm run cli:reindex -- backfill:auto   --contract <ID> --network <NET> [--batch-size N] [--type T]');
      console.log('  npm run cli:reindex -- backfill:status --contract <ID> --network <NET>');
      console.log('');
      console.log('backfill:auto auto-discovers deployment block and backfills from there (Issue #681).');
      break;
  }
}

if (require.main === module) {
  main()
    .finally(async () => {
      if (AppDataSource.isInitialized) await AppDataSource.destroy().catch(() => undefined);
    })
    .catch((err) => {
      logger.error({ err }, 'Backfill CLI failed');
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
