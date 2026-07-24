import { Router } from "express";
import { UserController } from "../controllers/UserController";
import { requireAuth } from "../middlewares/authMiddleware";

const userController = new UserController();
const router = Router();

// Public routes
router.get("/wallet/:walletAddress", userController.getUserByWalletAddress);
router.get("/:id", userController.getUserById);

// Protected routes (require authentication)
router.get("/", requireAuth, userController.getAllUsers);
router.put("/:id", requireAuth, userController.updateUser);
router.delete("/:id", requireAuth, userController.deleteUser);

export default router;
