import {Router} from "express";
import { UploadController } from "../controllers/UploadController";
import { validateDTO } from "../middlewares/validate";
import { FinalizeUploadDTO } from "../dtos/FinalizeUploadDTO";
import { UploadChunkDTO } from "../dtos/UploadChunkDTO";
import { authArtistMiddleware } from "../middlewares/authMiddleware";
import multer from "multer";
import { CreateCoverDTO } from "../dtos/CreateCoverDTO";

const uploadController = new UploadController();
const router = Router();
const upload = multer({ dest: "uploads/chunks/" });

router.post("/upload/chunk", authArtistMiddleware, upload.single("chunk"), validateDTO(UploadChunkDTO), uploadController.uploadChunk);
router.post("/upload/cover", authArtistMiddleware, upload.single("cover"), validateDTO(CreateCoverDTO), uploadController.uploadCover);
router.post("/upload/finalize", authArtistMiddleware, validateDTO(FinalizeUploadDTO), uploadController.finalizeUpload);

export default router;