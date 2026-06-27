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

const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 5321),
  username: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "1234",
  database: process.env.POSTGRES_DATABASE || "audioblocks",
  synchronize: true,
  dropSchema: false,
  ssl: false,
  logging: true,
  entities: [
    User,
    Song,
    TransactionLog,
    Genre,
    Album,
    RoyaltyPayout
  ],
  migrations: ["src/migrations/*.ts"],
  migrationsTableName: "migrations",
});

export default AppDataSource;
