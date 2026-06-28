import dotenv from "dotenv";

dotenv.config();

export interface ValidatedEnv {
  NODE_ENV: string;
  PORT: string;
  POSTGRES_HOST: string;
  POSTGRES_PORT: string;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DATABASE: string;
  JWT_SECRET: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  AWS_BUCKET_NAME: string;
  SOROBAN_NETWORK: string;
  PINATA_JWT: string;
  PINATA_GATEWAY: string;
}

const requiredVars: (keyof ValidatedEnv)[] = [
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DATABASE",
  "JWT_SECRET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "AWS_BUCKET_NAME",
  "PINATA_JWT",
  "PINATA_GATEWAY",
];

export function validateEnvironment(): ValidatedEnv {
  const missing: string[] = [];

  requiredVars.forEach((varName) => {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  });

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach((varName) => {
      console.error(`   - ${varName}`);
    });
    console.error(
      "\nℹ️  Copy .env.example to .env and fill in all required values."
    );
    process.exit(1);
  }

  return {
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: process.env.PORT || "4000",
    POSTGRES_HOST: process.env.POSTGRES_HOST!,
    POSTGRES_PORT: process.env.POSTGRES_PORT!,
    POSTGRES_USER: process.env.POSTGRES_USER!,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD!,
    POSTGRES_DATABASE: process.env.POSTGRES_DATABASE!,
    JWT_SECRET: process.env.JWT_SECRET!,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID!,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY!,
    AWS_REGION: process.env.AWS_REGION!,
    AWS_BUCKET_NAME: process.env.AWS_BUCKET_NAME!,
    SOROBAN_NETWORK: process.env.SOROBAN_NETWORK || "testnet",
    PINATA_JWT: process.env.PINATA_JWT!,
    PINATA_GATEWAY: process.env.PINATA_GATEWAY!,
  };
}
