import { rpc, Networks } from "@stellar/stellar-sdk";
import dotenv from "dotenv";

dotenv.config();

export function getSorobanRpcUrl(): string {
  const url = process.env.SOROBAN_RPC_URL;
  if (!url) throw new Error("SOROBAN_RPC_URL is not configured");
  return url;
}

export function getNetworkPassphrase(): string {
  return process.env.SOROBAN_NETWORK_PASSPHRASE || Networks.TESTNET;
}

export function getSorobanServer(): rpc.Server {
  return new rpc.Server(getSorobanRpcUrl(), { allowHttp: true });
}

function requireContractId(envVar: string): string {
  const id = process.env[envVar];
  if (!id) throw new Error(`${envVar} is not configured`);
  return id;
}

export const SorobanContracts = {
  get nft() {
    return requireContractId("NFT_CONTRACT_ID");
  },
  get artist() {
    return requireContractId("ARTIST_CONTRACT_ID");
  },
  get catalog() {
    return requireContractId("CATALOG_CONTRACT_ID");
  },
  get royalty() {
    return requireContractId("ROYALTY_CONTRACT_ID");
  },
  get marketplace() {
    return requireContractId("MARKETPLACE_CONTRACT_ID");
  },
};
