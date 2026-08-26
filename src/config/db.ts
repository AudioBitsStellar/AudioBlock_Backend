import 'reflect-metadata';
import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
import { User } from '../entities/User';
import { ActivityFeed } from '../entities/ActivityFeed';
import { RefreshToken } from '../entities/RefreshToken';
import { Song } from '../entities/Song';
import { TransactionLog } from '../entities/TransactionLog';
import { Genre } from '../entities/Genre';
import { Album } from '../entities/Album';
import { RoyaltyPayout } from '../entities/RoyaltyPayout';
import { RoyaltyTemplate } from '../entities/RoyaltyTemplate';
import { SongPlayEvent } from '../entities/SongPlayEvent';
import { SongCollaborator } from '../entities/SongCollaborator';
import { Tag } from '../entities/Tag';
import { SongTag } from '../entities/SongTag';
import { Release } from '../entities/Release';
import { ReleaseTrack } from '../entities/ReleaseTrack';
import { Subscription } from '../entities/Subscription';
import { ApiKey } from '../entities/ApiKey';
import { Comment } from '../entities/Comment';
import { UserSave } from '../entities/UserSave';
import { ArtistVerification } from '../entities/ArtistVerification';

dotenv.config();

/**
 * Connection pool configuration (Issue #134)
 * ───────────────────────────────────────────
 * All values are configurable via environment variables so pool sizing can be
 * tuned per-deployment without code changes. Defaults follow the acceptance
 * criteria: min 5, max 20, 30s connection timeout, 300s idle timeout.
 *
 *   DB_POOL_MAX                – max connections in the pool        (default 20)
 *   DB_POOL_MIN                – min connections kept warm          (default 5)
 *   DB_CONNECTION_TIMEOUT_MS   – wait time to acquire a connection  (default 30000)
 *   DB_IDLE_TIMEOUT_MS         – idle connection lifetime           (default 300000)
 *
 * The pg driver ignores keys it doesn't recognise, so passing these through
 * `extra` (node-postgres Pool options) is safe.
 */
export const dbPoolConfig = {
  max: Number(process.env.DB_POOL_MAX || 20),
  min: Number(process.env.DB_POOL_MIN || 5),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 30000),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 300000),
};

const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.DB_TYPE === 'sqlite';
const databaseType = process.env.DB_TYPE === 'sqlite' ? 'sqlite' : 'postgres';

const AppDataSource = new DataSource({
  type: databaseType as 'postgres' | 'sqlite',
  host: databaseType === 'postgres' ? process.env.POSTGRES_HOST || 'localhost' : undefined,
  port: databaseType === 'postgres' ? Number(process.env.POSTGRES_PORT || 5321) : undefined,
  username: databaseType === 'postgres' ? process.env.POSTGRES_USER || 'postgres' : undefined,
  password: databaseType === 'postgres' ? process.env.POSTGRES_PASSWORD || '1234' : undefined,
  database:
    databaseType === 'sqlite'
      ? process.env.SQLITE_DATABASE || ':memory:'
      : process.env.POSTGRES_DATABASE || 'audioblocks',
  synchronize: isTestEnvironment || process.env.NODE_ENV !== 'production',
  dropSchema: false,
  ssl: databaseType === 'postgres' ? false : undefined,
  logging: !isTestEnvironment,
  // Cap the pool at the configured maximum. `extra` carries the full set of
  // node-postgres Pool options (min/max sizing + timeouts).
  poolSize: databaseType === 'postgres' ? dbPoolConfig.max : undefined,
  extra:
    databaseType === 'postgres'
      ? {
          max: dbPoolConfig.max,
          min: dbPoolConfig.min,
          connectionTimeoutMillis: dbPoolConfig.connectionTimeoutMillis,
          idleTimeoutMillis: dbPoolConfig.idleTimeoutMillis,
        }
      : undefined,
  entities: [
    ActivityFeed,
    RefreshToken,
    User,
    Song,
    TransactionLog,
    Genre,
    Album,
    RoyaltyPayout,
    RoyaltyTemplate,
    SongPlayEvent,
    SongCollaborator,
    Tag,
    SongTag,
    Release,
    ReleaseTrack,
    Subscription,
    ApiKey,
    Comment,
    UserSave,
    ArtistVerification,
  ],
  migrations: ['src/migrations/*.ts', 'dist/migrations/*.js'],
  migrationsTableName: 'migrations',
});

export default AppDataSource;
