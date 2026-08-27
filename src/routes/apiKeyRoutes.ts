import { Router } from 'express';
import { ApiKeyController } from '../controllers/ApiKeyController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateDTO } from '../middlewares/validate';
import { CreateApiKeyDTO } from '../dtos/CreateApiKeyDTO';

const router = Router();
const apiKeyController = new ApiKeyController();

// Key management is JWT-only: an API key must not be able to mint or revoke
// keys, otherwise a leaked key could perpetuate its own access.
router.use(requireAuth);

router.post('/', validateDTO(CreateApiKeyDTO), apiKeyController.createApiKey);
router.get('/', apiKeyController.listApiKeys);
router.delete('/:id', apiKeyController.revokeApiKey);

export default router;
