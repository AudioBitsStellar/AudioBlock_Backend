import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'src/index.ts',
    'src/workers/SongProcessorWorker.ts',
    'src/seeders/genre.seeder.ts',
    'src/jobs/RoyaltyReconciliationJob.ts'
  ],
  project: [
    'src/**/*.ts'
  ],
  ignore: [
    'dist/**',
    'node_modules/**',
    'src/__tests__/**',
    'tests/**'
  ],
  ignoreDependencies: [
    '@types/*'
  ],
  ignoreExportsUsedInFile: true
};

export default config;
