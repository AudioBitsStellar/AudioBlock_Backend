import { Router } from 'express';
import { MarketplaceController } from '../controllers/MarketplaceController';
import { authArtistMiddleware, authListenerMiddleware } from '../middlewares/authMiddleware';
import { validateDTO } from '../middlewares/validate';
import { SubmitSignedXdrDTO } from '../dtos/SubmitSignedXdrDTO';
import { idempotency } from '../middlewares/idempotency';

const router = Router();

// Listing: seller (artist) lists an NFT for sale
router.post('/prepare-listing', authArtistMiddleware, MarketplaceController.prepareListing);
router.post(
  '/submit-listing',
  authArtistMiddleware,
  idempotency(),
  validateDTO(SubmitSignedXdrDTO),
  MarketplaceController.submitListing,
);

// Buy: any authenticated user purchases a listed NFT
router.post('/prepare-buy', authListenerMiddleware, MarketplaceController.prepareBuy);
router.post(
  '/submit-buy',
  authListenerMiddleware,
  idempotency(),
  validateDTO(SubmitSignedXdrDTO),
  MarketplaceController.submitBuy,
);

// Auction routes
router.post('/prepare-auction', authArtistMiddleware, MarketplaceController.prepareAuction);
router.post(
  '/submit-auction',
  authArtistMiddleware,
  idempotency(),
  validateDTO(SubmitSignedXdrDTO),
  MarketplaceController.submitAuction,
);

router.post('/prepare-bid', authListenerMiddleware, MarketplaceController.prepareBid);
router.post(
  '/submit-bid',
  authListenerMiddleware,
  idempotency(),
  validateDTO(SubmitSignedXdrDTO),
  MarketplaceController.submitBid,
);

export default router;
