import {
  Router,
  Request,
  Response,
  NextFunction,
  RequestHandler,
  ErrorRequestHandler,
} from "express";
import { WalletController } from "../controllers/WalletController";

const walletController = new WalletController();
const router = Router();


router.post("/evm/create", walletController.createEvmWallet);


export default router;