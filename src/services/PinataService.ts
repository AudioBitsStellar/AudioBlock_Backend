import { PinataSDK } from 'pinata';
import fs from 'fs';

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT!,
  pinataGateway: process.env.PINATA_GATEWAY!,
});

/**
 * IPFS pinning service via Pinata. Used to pin NFT metadata and cover art
 * for on-chain reference.
 */
export class PinataService {
  /**
   * Upload a local file to IPFS via Pinata.
   *
   * @param filePath - Absolute path to the file on disk.
   * @param fileName - Desired filename in IPFS.
   * @returns Pinata upload response with the IPFS CID.
   */
  static async uploadFile(filePath: string, fileName: string) {
    const file = new File([fs.readFileSync(filePath)], fileName);
    const res = await pinata.upload.public.file(file);
    return res;
  }

  /**
   * Upload a JSON object to IPFS via Pinata.
   *
   * @param data - The JSON-serializable data to pin.
   * @param fileName - Desired filename in IPFS (e.g. "metadata.json").
   * @returns Pinata upload response with the IPFS CID.
   */
  static async uploadJSON(data: any, fileName: string) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = new File([blob], fileName);
    const res = await pinata.upload.public.file(file);
    return res;
  }
}
