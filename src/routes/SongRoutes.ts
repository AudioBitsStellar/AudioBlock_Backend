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
import { SubmitSignedXdrDTO } from "../dtos/SubmitSignedXdrDTO";

const uploadController = new UploadController();
const router = Router();
// const upload = multer({ dest: "uploads/chunks/" });


// ── Chunked upload limits (#63) ───────────────────────────────────────────────
//
// Chunk size:   The backend imposes no per-chunk byte limit here (multer uses
//               memoryStorage default of 1 MB when no limit is set, but disk
//               storage has no default cap).  The artist-dashboard uploader
//               currently sends 5 MB chunks (CHUNK_SIZE = 5 * 1024 * 1024).
//               If you need to enforce a server-side cap, set:
//                 multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } })
//
// Concurrency: The artist-dashboard serialises chunk uploads (one at a time)
//               so the server never receives parallel chunk requests for the
//               same fileId.  Re-ordering is handled by chunkIndex in the
//               finalize step.  If the frontend uploader changes to parallel
//               uploads, add a per-fileId in-flight counter here.
//
// Max file:    Total audio file size is not bounded at the chunk layer.
//               Add a per-session size accumulator in saveChunk() if you need
//               to enforce a maximum.
const CHUNK_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per chunk (safety cap)

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/temp";

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(7)}`);
  }
});

const upload = multer({ storage, limits: { fileSize: CHUNK_MAX_SIZE_BYTES } });
// const upload = multer({ dest: "uploads/temp/" });
router.post("/upload/chunk", authArtistMiddleware, upload.single("chunk"), validateDTO(UploadChunkDTO), uploadController.uploadChunk);
router.post("/upload/cover", authArtistMiddleware, upload.single("cover"), validateDTO(CreateCoverDTO), uploadController.uploadCover);
router.post("/upload/finalize", authArtistMiddleware, validateDTO(FinalizeUploadDTO), uploadController.finalizeUpload);


// Stream Songs
router.get("/stream/:id", SongController.streamSong);
router.get("/popular", SongController.getPopularSongs);

// Soroban on-chain song minting: the artist's wallet signs, the backend
// only builds and relays the transaction.
router.post("/:id/onchain/prepare-mint", authArtistMiddleware, SongController.prepareMint);
router.post(
  "/:id/onchain/submit-mint",
  authArtistMiddleware,
  validateDTO(SubmitSignedXdrDTO),
  SongController.submitMint
);

export default router;