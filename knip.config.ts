import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'src/index.ts!',
    // Deployable entrypoints (Issue #965): each is its own process/container.
    'src/workers/SongProcessorWorker.ts!',
    'src/workers/songWorkerMain.ts!',
    'src/workers/indexer/index.ts!',
    'src/workers/scheduler.ts!',
    'src/jobs/scheduler.ts!',
    'src/jobs/DailyPlaybackAggregationJob.ts!',
    'src/jobs/RoyaltyReconciliationJob.ts!',
    'src/jobs/AccountDeletionJob.ts!',
    'src/jobs/OnChainReconciliationJob.ts!',
    'src/seeders/genre.seeder.ts!',
    'src/migrations/*.ts!',
  ],
  project: ['src/**/*.ts!'],
  ignore: ['src/**/__tests__/**', 'tests/**'],
  ignoreDependencies: ['@types/*', 'pino-pretty', 'lint-staged', 'viem'],
  ignoreExportsUsedInFile: true,
  rules: {
    enumMembers: 'off',
    duplicates: 'off',
  },
};

export default config;
