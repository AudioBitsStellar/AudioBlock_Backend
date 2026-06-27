import { Router } from "express";
import { MarketplaceController } from "../controllers/MarketplaceController";
import { authArtistMiddleware, authListenerMiddleware } from "../middlewares/authMiddleware";
import { validateDTO } from "../middlewares/validate";
import { SubmitSignedXdrDTO } from "../dtos/SubmitSignedXdrDTO";

const router = Router();

// Listing: seller (artist) lists an NFT for sale
router.post("/prepare-listing", authArtistMiddleware, MarketplaceController.prepareListing);
router.post("/submit-listing", authArtistMiddleware, validateDTO(SubmitSignedXdrDTO), MarketplaceController.submitListing);

// Buy: any authenticated user purchases a listed NFT
router.post("/prepare-buy", authListenerMiddleware, MarketplaceController.prepareBuy);
router.post("/submit-buy", authListenerMiddleware, validateDTO(SubmitSignedXdrDTO), MarketplaceController.submitBuy);

export default router;
