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


export default router;