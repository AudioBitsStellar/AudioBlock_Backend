import {Router} from "express";
import { UploadController } from "../controllers/UploadController";
import { validateDTO } from "../middlewares/validate";
import { FinalizeUploadDTO } from "../dtos/FinalizeUploadDTO";
import { UploadChunkDTO } from "../dtos/UploadChunkDTO";
import { authArtistMiddleware } from "../middlewares/authMiddleware";
import multer from "multer";
import { CreateCoverDTO } from "../dtos/CreateCoverDTO";
import fs from "fs";
import { SongController } from "../controllers/SongController";

const uploadController = new UploadController();
const router = Router();
// const upload = multer({ dest: "uploads/chunks/" });


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/temp";
    
    // Ensure directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Keep multer's default random filename
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(7)}`);
  }
});

const upload = multer({ storage });
// const upload = multer({ dest: "uploads/temp/" });
router.post("/upload/chunk", authArtistMiddleware, upload.single("chunk"), validateDTO(UploadChunkDTO), uploadController.uploadChunk);
router.post("/upload/cover", authArtistMiddleware, upload.single("cover"), validateDTO(CreateCoverDTO), uploadController.uploadCover);
router.post("/upload/finalize", authArtistMiddleware, validateDTO(FinalizeUploadDTO), uploadController.finalizeUpload);


// Stream Songs
router.get("/stream/:id", SongController.streamSong);

export default router;