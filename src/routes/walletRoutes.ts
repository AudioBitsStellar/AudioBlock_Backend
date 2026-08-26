import { Router } from 'express';
import { WalletController } from '../controllers/WalletController';
import { validateDTO } from '../middlewares/validate';
import { SignMessageDTO } from '../dtos/SignMessageDTO';
import { requireAuth } from '../middlewares/authMiddleware';

const walletController = new WalletController();
const router = Router();

router.post('/evm/create', walletController.createEvmWallet);
router.post('/evm/signMessage', validateDTO(SignMessageDTO), walletController.signMessage);

// Wallet balance history (Issue #84)
router.get('/history', requireAuth, walletController.getWalletHistory);

export default router;
