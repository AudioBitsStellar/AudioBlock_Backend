import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'src/index.ts!',
    'src/workers/SongProcessorWorker.ts!',
    'src/workers/indexer/index.ts!',
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
