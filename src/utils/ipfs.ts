import { PinataSDK } from "pinata";
import fs from "fs";
import path from "path";


export const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT!,
    pinataGateway: process.env.PINATA_GATEWAY!,
});

/**
 * Upload a single file to IPFS (using Pinata)
 */
export async function uploadFileToPinata(filePath: string, mimeType = "audio/mpeg") {
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer]);
  const file = new File([blob], path.basename(filePath), { type: mimeType });

  const upload = await pinata.upload.public.file(file);
  return upload; // { cid, uri, name }
}

/**
 * Upload JSON metadata to IPFS
 */
export async function uploadJsonToPinata(metadata: Record<string, any>) {
  const upload = await pinata.upload.public.json(metadata);
  return upload; // { cid, uri, name }
}