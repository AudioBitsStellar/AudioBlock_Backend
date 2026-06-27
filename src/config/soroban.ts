import { rpc, Networks } from "@stellar/stellar-sdk";
import dotenv from "dotenv";

dotenv.config();

export type SorobanNetwork = "testnet" | "mainnet";
type ContractName = "nft" | "artist" | "catalog" | "royalty" | "marketplace";

const CONTRACT_ENV_SUFFIXES: Record<ContractName, string> = {
  nft: "NFT_CONTRACT_ID",
  artist: "ARTIST_CONTRACT_ID",
  catalog: "CATALOG_CONTRACT_ID",
  royalty: "ROYALTY_CONTRACT_ID",
  marketplace: "MARKETPLACE_CONTRACT_ID",
};

const DEFAULT_RPC_URLS: Record<SorobanNetwork, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
};

const DEFAULT_PASSPHRASES: Record<SorobanNetwork, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
};

export function getSorobanNetwork(): SorobanNetwork {
  const network = (process.env.SOROBAN_NETWORK || "testnet").toLowerCase();
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error("SOROBAN_NETWORK must be either testnet or mainnet");
  }
  return network;
}

export function getSorobanRpcUrl(): string {
  const network = getSorobanNetwork();
  const url =
    process.env[`SOROBAN_${network.toUpperCase()}_RPC_URL`] ||
    process.env.SOROBAN_RPC_URL ||
    DEFAULT_RPC_URLS[network];
  if (!url) throw new Error("SOROBAN_RPC_URL is not configured");
  return url;
}

export function getNetworkPassphrase(): string {
  const network = getSorobanNetwork();
  return (
    process.env[`SOROBAN_${network.toUpperCase()}_NETWORK_PASSPHRASE`] ||
    process.env.SOROBAN_NETWORK_PASSPHRASE ||
    DEFAULT_PASSPHRASES[network]
  );
}

export function getSorobanServer(): rpc.Server {
  return new rpc.Server(getSorobanRpcUrl(), { allowHttp: true });
}

function contractEnvVar(contractName: ContractName): string {
  return `SOROBAN_${getSorobanNetwork().toUpperCase()}_${CONTRACT_ENV_SUFFIXES[contractName]}`;
}

function requireContractId(contractName: ContractName): string {
  const envVar = contractEnvVar(contractName);
  const id = process.env[envVar];
  if (!id) throw new Error(`${envVar} is not configured`);
  return id;
}

export function validateSorobanConfig(): void {
  const missing = (Object.keys(CONTRACT_ENV_SUFFIXES) as ContractName[])
    .map(contractEnvVar)
    .filter((envVar) => !process.env[envVar]);

  if (missing.length > 0) {
    throw new Error(
      `Missing Soroban contract IDs for ${getSorobanNetwork()}: ${missing.join(", ")}`,
    );
  }
}

export const SorobanContracts = {
  get nft() {
    return requireContractId("nft");
  },
  get artist() {
    return requireContractId("artist");
  },
  get catalog() {
    return requireContractId("catalog");
  },
  get royalty() {
    return requireContractId("royalty");
  },
  get marketplace() {
    return requireContractId("marketplace");
  },
};
