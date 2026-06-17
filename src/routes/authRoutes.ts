import {
  Router,
  Request,
  Response,
  NextFunction,
  RequestHandler,
  ErrorRequestHandler,
} from "express";
import { AuthController } from "../controllers/AuthController";

const authController = new AuthController();
const router = Router();


router.get("/nonce/:email", authController.getUserNonce);
router.post("/register", authController.register);
router.post("/register-listener", authController.registerListener);
router.post("/login", authController.login);

// Email + password auth (no wallet signature required) — coexists with the
// wallet-signature flow above. Either path issues the same JWT shape.
router.post("/register-email", authController.registerWithEmail);
router.post("/login-email", authController.loginWithEmail);


export default router;