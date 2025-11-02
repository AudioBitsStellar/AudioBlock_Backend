import {
  Router,
  Request,
  Response,
  NextFunction,
  RequestHandler,
  ErrorRequestHandler,
} from "express";
import { ArtistProfileController } from "../controllers/ArtistProfileController";
import { validateDTO } from "../middlewares/validate";
import { authArtistMiddleware } from "../middlewares/authMiddleware";
import { UpdateArtistProfileDTO } from "../dtos/UpdateArtistProfileDTO";
import { upload } from "../middlewares/upload";

const artistProfileController = new ArtistProfileController();
const router = Router();

router.patch("/update-profile", authArtistMiddleware, upload.fields([
  { name: "profileImage", maxCount: 1 },
  { name: "pageCover", maxCount: 1 },
]), artistProfileController.updateProfile);


export default router;