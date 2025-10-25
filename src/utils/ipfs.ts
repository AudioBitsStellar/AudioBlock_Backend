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
 * Uploads a full HLS folder (master.m3u8 + all .ts files)
 * Returns the CID of the root folder.
 */
export async function uploadHLSFolderToPinata(folderPath: string) {
  const files = fs.readdirSync(folderPath);
  const uploadFiles = [];

  for (const filename of files) {
    const fullPath = path.join(folderPath, filename);
    const fileBuffer = fs.readFileSync(fullPath);
    const blob = new Blob([fileBuffer]);
    const file = new File([blob], filename);
    uploadFiles.push(file);
  }

  const result = await pinata.upload.public.fileArray(uploadFiles);

  return result; // { cid, ipfsUrl, etc. }
}


/**
 * Upload JSON metadata to IPFS
 */
export async function uploadJsonToPinata(metadata: Record<string, any>) {
  const upload = await pinata.upload.public.json(metadata);
  return upload; // { cid, uri, name }
}