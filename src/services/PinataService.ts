import { PinataSDK } from "pinata";
import fs from "fs";

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT!,
  pinataGateway: process.env.PINATA_GATEWAY!
});

export class PinataService {
  static async uploadFile(filePath: string, fileName: string) {
    const file = new File([fs.readFileSync(filePath)], fileName);
    const res = await pinata.upload.public.file(file);
    return res;
  }

  static async uploadJSON(data: any, fileName: string) {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const file = new File([blob], fileName);
    const res = await pinata.upload.public.file(file);
    return res;
  }
}
