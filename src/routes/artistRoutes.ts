import {
  Router,
  Request,
  Response,
  NextFunction,
  RequestHandler,
  ErrorRequestHandler,
} from "express";
import { ArtistProfileController } from "../controllers/ArtistProfileController";
import { ArtistOnChainController } from "../controllers/ArtistOnChainController";
import { validateDTO } from "../middlewares/validate";
import { authArtistMiddleware } from "../middlewares/authMiddleware";
import { UpdateArtistProfileDTO } from "../dtos/UpdateArtistProfileDTO";
import { ConnectStellarWalletDTO } from "../dtos/ConnectStellarWalletDTO";
import { PrepareArtistSetupDTO } from "../dtos/PrepareArtistSetupDTO";
import { SubmitSignedXdrDTO } from "../dtos/SubmitSignedXdrDTO";
import { upload } from "../middlewares/upload";

const artistProfileController = new ArtistProfileController();
const artistOnChainController = new ArtistOnChainController();
const router = Router();

router.patch("/update-profile", authArtistMiddleware, upload.fields([
  { name: "profileImage", maxCount: 1 },
  { name: "pageCover", maxCount: 1 },
]), artistProfileController.updateProfile);

// Soroban on-chain artist setup: the artist's wallet (e.g. Freighter) signs,
// the backend only builds and relays the transaction.
router.post(
  "/onchain/connect-wallet",
  authArtistMiddleware,
  validateDTO(ConnectStellarWalletDTO),
  artistOnChainController.connectWallet
);
router.post(
  "/onchain/prepare-setup",
  authArtistMiddleware,
  validateDTO(PrepareArtistSetupDTO),
  artistOnChainController.prepareSetup
);
router.post(
  "/onchain/submit-setup",
  authArtistMiddleware,
  validateDTO(SubmitSignedXdrDTO),
  artistOnChainController.submitSetup
);

export default router;