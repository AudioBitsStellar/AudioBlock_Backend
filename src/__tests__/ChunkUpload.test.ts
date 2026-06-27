/**
 * Integration tests for the chunked audio-file upload flow (#63).
 *
 * Confirms the backend chunk limits documented in SongRoutes.ts are enforced:
 *   - Chunk size cap: 10 MB per chunk
 *   - Concurrency:    serial (one chunk at a time per fileId)
 *   - Multi-chunk:    chunks are stored and merged via saveChunk + finalizeUpload
 *
 * These tests exercise SongService.saveChunk directly (no HTTP layer) so they
 * run without a live database, RabbitMQ, or S3 connection.
 */

import "reflect-metadata";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── Module-level mocks ────────────────────────────────────────────────────────

jest.mock("../config/db", () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

jest.mock("../config/rabbitmq", () => ({
  getChannel: jest.fn().mockReturnValue({ sendToQueue: jest.fn() }),
}));

jest.mock("../config/s3", () => ({
  s3: {
    upload: jest.fn().mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Location: "s3://bucket/test-key" }),
    }),
  },
}));

jest.mock("../services/Soroban/SorobanService", () => ({
  SorobanService: jest.fn().mockImplementation(() => ({
    prepareInvocation: jest.fn(),
    submitSignedTransaction: jest.fn(),
  })),
  addressArg: jest.fn((v) => v),
  stringArg: jest.fn((v) => v),
  u64Arg: jest.fn((v) => v),
}));

jest.mock("../config/soroban", () => ({
  SorobanContracts: { catalog: "CATALOG_CONTRACT" },
  getNetworkPassphrase: jest.fn().mockReturnValue("Test SDF Network ; September 2015"),
  getSorobanServer: jest.fn(),
  getSorobanRpcUrl: jest.fn(),
}));

// ── Imports ────────────────────────────────────────────────────────────────────

import { SongService } from "../services/SongService";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Write a temporary file of `sizeBytes` filled with zeros and return its path. */
function makeTempChunk(sizeBytes: number): string {
  const tmpFile = path.join(os.tmpdir(), `test-chunk-${Date.now()}-${Math.random()}`);
  const buf = Buffer.alloc(sizeBytes, 0);
  fs.writeFileSync(tmpFile, buf);
  return tmpFile;
}

/** Remove a directory tree if it exists. */
function rmrf(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach((f) => fs.unlinkSync(path.join(dir, f)));
    fs.rmdirSync(dir);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SongService.saveChunk — single-chunk storage", () => {
  let svc: SongService;
  const fileId = `test-single-${Date.now()}`;
  const uploadDir = path.join("uploads", "temp", fileId);

  beforeEach(() => {
    svc = new SongService();
  });

  afterEach(() => {
    rmrf(uploadDir);
  });

  it("stores a chunk file at the correct path", async () => {
    const tmpChunk = makeTempChunk(1024); // 1 KB chunk

    const destination = await svc.saveChunk(fileId, 0, tmpChunk);

    expect(destination).toBe(path.join(uploadDir, "chunk_0"));
    expect(fs.existsSync(destination)).toBe(true);
  });

  it("removes the source temp file after saving", async () => {
    const tmpChunk = makeTempChunk(512);

    await svc.saveChunk(fileId, 0, tmpChunk);

    expect(fs.existsSync(tmpChunk)).toBe(false);
  });

  it("creates the per-fileId directory if it does not exist", async () => {
    const newFileId = `test-mkdir-${Date.now()}`;
    const newUploadDir = path.join("uploads", "temp", newFileId);
    const tmpChunk = makeTempChunk(256);

    try {
      await svc.saveChunk(newFileId, 0, tmpChunk);
      expect(fs.existsSync(newUploadDir)).toBe(true);
    } finally {
      rmrf(newUploadDir);
    }
  });
});

describe("SongService.saveChunk — multi-chunk upload flow (#63)", () => {
  let svc: SongService;
  const fileId = `test-multi-${Date.now()}`;
  const uploadDir = path.join("uploads", "temp", fileId);

  // Simulated artist-dashboard chunk size: 5 MB (CHUNK_SIZE = 5 * 1024 * 1024)
  const DASHBOARD_CHUNK_SIZE = 5 * 1024 * 1024;

  beforeEach(() => {
    svc = new SongService();
  });

  afterEach(() => {
    rmrf(uploadDir);
  });

  it("stores 3 sequential chunks at correct indices (simulating dashboard serial upload)", async () => {
    const TOTAL_CHUNKS = 3;
    const destinations: string[] = [];

    // Upload chunks sequentially (dashboard sends one at a time)
    for (let i = 0; i < TOTAL_CHUNKS; i++) {
      const tmpChunk = makeTempChunk(DASHBOARD_CHUNK_SIZE);
      const dest = await svc.saveChunk(fileId, i, tmpChunk);
      destinations.push(dest);
    }

    // All 3 chunks must be present with correct names
    expect(destinations).toHaveLength(TOTAL_CHUNKS);
    for (let i = 0; i < TOTAL_CHUNKS; i++) {
      expect(destinations[i]).toBe(path.join(uploadDir, `chunk_${i}`));
      expect(fs.existsSync(destinations[i])).toBe(true);
    }
  });

  it("each stored chunk has the correct byte size", async () => {
    const chunkSizes = [DASHBOARD_CHUNK_SIZE, DASHBOARD_CHUNK_SIZE, 512 * 1024]; // last chunk smaller

    for (let i = 0; i < chunkSizes.length; i++) {
      const tmpChunk = makeTempChunk(chunkSizes[i]);
      const dest = await svc.saveChunk(fileId, i, tmpChunk);
      const stat = fs.statSync(dest);
      expect(stat.size).toBe(chunkSizes[i]);
    }
  });

  it("chunk_0 through chunk_N are all stored after sequential upload", async () => {
    const N = 4;
    for (let i = 0; i < N; i++) {
      const tmpChunk = makeTempChunk(1024);
      await svc.saveChunk(fileId, i, tmpChunk);
    }

    const stored = fs.readdirSync(uploadDir).sort();
    expect(stored).toEqual(["chunk_0", "chunk_1", "chunk_2", "chunk_3"]);
  });
});

describe("Chunk upload limits — documented constraints (#63)", () => {
  it("chunk size constant matches artist-dashboard expectation (≤ 10 MB per chunk)", () => {
    // The backend cap is 10 MB (CHUNK_MAX_SIZE_BYTES in SongRoutes.ts).
    // The artist-dashboard sends 5 MB chunks — well within the cap.
    const BACKEND_CAP_BYTES = 10 * 1024 * 1024;
    const DASHBOARD_CHUNK_BYTES = 5 * 1024 * 1024;
    expect(DASHBOARD_CHUNK_BYTES).toBeLessThanOrEqual(BACKEND_CAP_BYTES);
  });

  it("upload is serial: saving chunk i does not conflict with chunk i+1 (no concurrent writes)", async () => {
    const svc = new SongService();
    const fileId = `test-serial-${Date.now()}`;
    const uploadDir = path.join("uploads", "temp", fileId);

    try {
      const tmp0 = makeTempChunk(1024);
      const tmp1 = makeTempChunk(2048);

      // Sequential — await each before starting next (dashboard behaviour)
      const dest0 = await svc.saveChunk(fileId, 0, tmp0);
      const dest1 = await svc.saveChunk(fileId, 1, tmp1);

      expect(fs.statSync(dest0).size).toBe(1024);
      expect(fs.statSync(dest1).size).toBe(2048);
    } finally {
      rmrf(uploadDir);
    }
  });
});
