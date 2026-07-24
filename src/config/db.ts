import "reflect-metadata";
import { DataSource } from "typeorm";
import dotenv from "dotenv";
import { User } from "../entities/User";
import { Song } from "../entities/Song";
import { TransactionLog } from "../entities/TransactionLog";
import { Genre } from "../entities/Genre";
import { Album } from "../entities/Album";
import { RoyaltyPayout } from "../entities/RoyaltyPayout";



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

const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 5321),
  username: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "1234",
  database: process.env.POSTGRES_DATABASE || "audioblocks",
  synchronize: process.env.NODE_ENV !== "production",
  dropSchema: false,
  ssl: false,
  logging: true,
  // Cap the pool at the configured maximum. `extra` carries the full set of
  // node-postgres Pool options (min/max sizing + timeouts).
  poolSize: dbPoolConfig.max,
  extra: {
    max: dbPoolConfig.max,
    min: dbPoolConfig.min,
    connectionTimeoutMillis: dbPoolConfig.connectionTimeoutMillis,
    idleTimeoutMillis: dbPoolConfig.idleTimeoutMillis,
  },
  entities: [
    User,
    Song,
    TransactionLog,
    Genre,
    Album,
    RoyaltyPayout
  ],
  migrations: ["src/migrations/*.ts", "dist/migrations/*.js"],
  migrationsTableName: "migrations",
});

export default AppDataSource;
