import { Router } from 'express';
import { ArtistProfileController } from '../controllers/ArtistProfileController';
import { ArtistOnChainController } from '../controllers/ArtistOnChainController';
import { ArtistMetadataController } from '../controllers/ArtistMetadataController';
import { SongController } from '../controllers/SongController';
import { validateDTO } from '../middlewares/validate';
import {
  authArtistMiddleware,
  optionalAuth,
  requireArtistAndVerified,
} from '../middlewares/authMiddleware';
import { ConnectStellarWalletDTO } from '../dtos/ConnectStellarWalletDTO';
import { PrepareArtistSetupDTO } from '../dtos/PrepareArtistSetupDTO';
import { SubmitSignedXdrDTO } from '../dtos/SubmitSignedXdrDTO';
import { ApplyVerificationDTO } from '../dtos/ApplyVerificationDTO';
import { upload } from '../middlewares/upload';

const artistProfileController = new ArtistProfileController();
const artistOnChainController = new ArtistOnChainController();
const router = Router();

// Artist verification badge workflow (Issue #92, #426)
router.post(
  '/verify/apply',
  authArtistMiddleware,
  validateDTO(ApplyVerificationDTO),
  artistProfileController.applyForVerification,
);
router.get('/verify/me', authArtistMiddleware, artistProfileController.getMyVerification);
router.get('/:id/verification', artistProfileController.getVerificationBadge);

// Public metadata endpoint for OG tags / JSON-LD (no auth, no private data)
router.get('/:id/metadata', ArtistMetadataController.getMetadata);

// Artist statistics (Issues #814, #846). Mounted at both /api/artist and
// /api/artists (see app.ts). `optionalAuth` + ownership check in the controller:
// owner/admin sees plays/saves/uniqueListeners/revenueStroops + all-time followers,
// public sees plays/saves/followers. 404 ARTIST_HAS_NO_SONGS when no songs.
router.get('/:id/stats', optionalAuth, SongController.getArtistStats);

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

export default router;
