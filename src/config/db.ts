import 'reflect-metadata';
import { DataSource, getMetadataArgsStorage } from 'typeorm';
import dotenv from 'dotenv';
import { User } from '../entities/User';
import { Song } from '../entities/Song';
import { TransactionLog } from '../entities/TransactionLog';
import { Genre } from '../entities/Genre';
import { Album } from '../entities/Album';
import { RoyaltyPayout } from '../entities/RoyaltyPayout';
import { WebhookSubscription } from '../entities/WebhookSubscription';
import { TakedownRequest } from '../entities/TakedownRequest';
import { ApiKey } from '../entities/ApiKey';
import { AiGenerationRecord } from '../entities/AiGenerationRecord';
import { TweetDraft } from '../entities/TweetDraft';
import { IndexerCursor } from '../entities/IndexerCursor';
import { BackfillStatus } from '../entities/BackfillStatus';
import { IndexedEvent } from '../entities/IndexedEvent';
import { RefreshToken } from '../entities/RefreshToken';

dotenv.config();

const entities = [
  User,
  Song,
  TransactionLog,
  Genre,
  Album,
  RoyaltyPayout,
  WebhookSubscription,
  TakedownRequest,
  ApiKey,
  AiGenerationRecord,
  TweetDraft,
  IndexerCursor,
  BackfillStatus,
  IndexedEvent,
  // RefreshToken backs the refresh-token rotation in AuthService; without it
  // getRepository(RefreshToken) throws EntityMetadataNotFoundError on every
  // register/login/refresh call.
  RefreshToken,
];

// Integration tests declare `process.env.DB_TYPE = 'sqlite'` before importing
// this module (see tests/integration/*) so they can run without a Postgres
// server. Honouring it here makes those suites actually executable; anything
// else — including production — keeps the Postgres defaults below.
const useSqlite = process.env.DB_TYPE === 'sqlite';

// Several entities use Postgres-only column types (`timestamp`, native
// `enum`, `jsonb`) that the sqlite driver rejects during metadata
// validation. Translate them to their sqlite equivalents in the decorator
// metadata before the DataSource is built. This runs only when
// DB_TYPE === 'sqlite' (integration tests), never in Postgres mode, so
// production column types and migrations are untouched.
if (useSqlite) {
  const sqliteTypeOverrides: Record<string, string> = {
    timestamp: 'datetime',
    enum: 'simple-enum',
    jsonb: 'json',
  };
  for (const column of getMetadataArgsStorage().columns) {
    const current = column.options.type;
    if (typeof current === 'string' && sqliteTypeOverrides[current]) {
      column.options.type = sqliteTypeOverrides[current] as typeof column.options.type;
    }
  }
}

const AppDataSource = new DataSource(
  useSqlite
    ? {
        type: 'sqlite',
        database: process.env.SQLITE_DATABASE || ':memory:',
        synchronize: true,
        dropSchema: false,
        logging: false,
        entities,
        migrations: [],
      }
    : {
        type: 'postgres',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: Number(process.env.POSTGRES_PORT || 5321),
        username: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || '1234',
        database: process.env.POSTGRES_DATABASE || 'audioblocks',
        synchronize: process.env.NODE_ENV !== 'production',
        dropSchema: false,
        ssl: false,
        logging: true,
        entities,
        migrations: [__dirname + '/../migrations/*.{js,ts}'],
        migrationsTableName: 'migrations',
      },
);

export default AppDataSource;
