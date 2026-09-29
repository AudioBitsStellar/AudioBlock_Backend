#!/usr/bin/env ts-node
/**
 * Projection CLI (Issue #261)
 *
 * Builds derived read models from the raw `indexed_events` table. Raw events
 * are never modified, so a projection can be rebuilt at any time, e.g. after
 * fixing a bug in its logic.
 *
 * Usage:
 *   npm run cli:project -- [--rebuild] [--projection <NAME>]
 *
 * Without --rebuild, applies only raw events newer than each checkpoint.
 * With --rebuild, resets the projection(s) and replays every raw event.
 */

import AppDataSource from '../config/db';
import logger from '../config/logger';
import { EventProjector, ProjectionRunResult } from '../services/EventProjector';

interface ProjectOptions {
  rebuild: boolean;
  projection?: string;
}

function parseArgs(argv: string[] = process.argv.slice(2)): ProjectOptions | null {
  const options: ProjectOptions = { rebuild: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rebuild') {
      options.rebuild = true;
    } else if (arg === '--projection' && i + 1 < argv.length) {
      options.projection = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      return null;
    } else {
      return null;
    }
  }

  return options;
}

function printUsage(projections: string[]): void {
  console.log(`
Usage: npm run cli:project -- [options]

Options:
  --rebuild              Reset the projection(s) and replay all raw events
  --projection <NAME>    Only run this projection (default: all)
  --help, -h             Show this help message

Known projections: ${projections.join(', ')}
`);
}

async function runProjections(
  options: ProjectOptions,
  projector: EventProjector = new EventProjector(),
): Promise<ProjectionRunResult[]> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const results = options.rebuild
    ? await projector.rebuild(options.projection)
    : await projector.catchUp(options.projection);

  for (const result of results) {
    logger.info(result, options.rebuild ? 'Projection rebuilt' : 'Projection caught up');
  }
  return results;
}

async function main(): Promise<void> {
  const options = parseArgs();
  if (!options) {
    printUsage(new EventProjector().listProjections());
    process.exit(1);
  }

  try {
    await runProjections(options);
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Projection run failed');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { parseArgs, runProjections };
