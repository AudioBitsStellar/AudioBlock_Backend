import { Router } from 'express';
import { ArtistProfileController } from '../controllers/ArtistProfileController';
import { ArtistOnChainController } from '../controllers/ArtistOnChainController';
import { validateDTO } from '../middlewares/validate';
import { authArtistMiddleware, requireArtistAndVerified } from '../middlewares/authMiddleware';
import { ConnectStellarWalletDTO } from '../dtos/ConnectStellarWalletDTO';
import { PrepareArtistSetupDTO } from '../dtos/PrepareArtistSetupDTO';
import { SubmitSignedXdrDTO } from '../dtos/SubmitSignedXdrDTO';
import { upload } from '../middlewares/upload';
import { etagCache } from '../middlewares/etag';
import { SongController } from '../controllers/SongController';

const artistProfileController = new ArtistProfileController();
const artistOnChainController = new ArtistOnChainController();
const router = Router();

router.patch(
  '/update-profile',
  authArtistMiddleware,
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'pageCover', maxCount: 1 },
  ]),
  artistProfileController.updateProfile,
);

// Soroban on-chain artist setup: the artist's wallet (e.g. Freighter) signs,
// the backend only builds and relays the transaction. Requires email verification.
router.post(
  '/onchain/connect-wallet',
  requireArtistAndVerified,
  validateDTO(ConnectStellarWalletDTO),
  artistOnChainController.connectWallet,
);
router.post(
  '/onchain/prepare-setup',
  requireArtistAndVerified,
  validateDTO(PrepareArtistSetupDTO),
  artistOnChainController.prepareSetup,
);
router.post(
  '/onchain/submit-setup',
  requireArtistAndVerified,
  validateDTO(SubmitSignedXdrDTO),
  artistOnChainController.submitSetup,
);

// Artist-level statistics aggregation (Issue #87). Mounted on both /api/artist
// and /api/artists, so `GET /api/artists/:id/stats` resolves.
router.get(
  '/:id/stats',
  etagCache({ visibility: 'private', maxAge: 300 }),
  SongController.getArtistStats,
);

export default router;
