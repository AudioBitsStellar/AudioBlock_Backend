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
import { CreateArtistProfileDTO } from "../dtos/CreateArtistProfileDTO";
import { authArtistMiddleware } from "../middlewares/authMiddleware";

const artistProfileController = new ArtistProfileController();
const router = Router();

router.post("/create-profile", authArtistMiddleware, validateDTO(CreateArtistProfileDTO), artistProfileController.createProfile)


export default router;