import logger from "../../utils/logger";

export async function sendToBlockchain(artistId: string, metadataCid: string) {
  logger.info({ artistId, metadataCid }, "Blockchain: registering CID");
  // Example: await dynamic.wallet.sendTransaction({...})

  logger.debug("Perform blockchain operation here");
}
