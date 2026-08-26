import { Router } from 'express';
import { ArtistProfileController } from '../controllers/ArtistProfileController';
import { ArtistOnChainController } from '../controllers/ArtistOnChainController';
import { validateDTO } from '../middlewares/validate';
import {
  authArtistMiddleware,
  requireArtistAndVerified,
  requireAuth,
} from '../middlewares/authMiddleware';
import { ConnectStellarWalletDTO } from '../dtos/ConnectStellarWalletDTO';
import { PrepareArtistSetupDTO } from '../dtos/PrepareArtistSetupDTO';
import { SubmitSignedXdrDTO } from '../dtos/SubmitSignedXdrDTO';
import { ApplyVerificationDTO } from '../dtos/ApplyVerificationDTO';
import { upload } from '../middlewares/upload';

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

// Artist verification badge (Issue #92). Applying requires the artist role;
// the badge itself is public so any client can render it on a profile.
router.post(
  '/verify/apply',
  authArtistMiddleware,
  validateDTO(ApplyVerificationDTO),
  artistProfileController.applyForVerification,
);
router.get('/verify/me', authArtistMiddleware, artistProfileController.getMyVerification);
router.get('/:id/verification', artistProfileController.getVerificationBadge);

// Follow / Unfollow (Issue #81)
router.post('/:id/follow', requireAuth, artistProfileController.followArtist);
router.delete('/:id/follow', requireAuth, artistProfileController.unfollowArtist);
router.get('/:id/followers', artistProfileController.getFollowers);
router.get('/:id/following', artistProfileController.getFollowing);

export default router;
