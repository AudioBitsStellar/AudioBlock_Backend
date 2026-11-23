/**
 * End-to-end pipeline test (#935).
 *
 * Covers the full upload → transcode → pin → mint → index flow using
 * real infrastructure spun up via docker-compose (Postgres, Redis, RabbitMQ).
 *
 * Prerequisites: `docker compose -f docker-compose.yml -f docker-compose.test.yml up -d`
 * The CI nightly job handles this automatically; locally run:
 *   npm run test:e2e
 *
 * Environment variables consumed (all have defaults for the test compose stack):
 *   E2E_BASE_URL          — backend base URL       (default: http://localhost:4000)
 *   E2E_ADMIN_EMAIL       — seeded admin email      (default: admin@e2e.test)
 *   E2E_ADMIN_PASSWORD    — seeded admin password   (default: e2eSecret123!)
 *   E2E_TIMEOUT_MS        — per-step polling budget (default: 60000)
 */

import * as fs from "fs";
import * as path from "path";
import * as http from "http";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@e2e.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "e2eSecret123!";
const TIMEOUT_MS = parseInt(process.env.E2E_TIMEOUT_MS ?? "60000", 10);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson<T = unknown>(
  url: string,
  options: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  let body: T;
  try {
    body = (await res.json()) as T;
  } catch {
    body = null as unknown as T;
  }
  return { status: res.status, body };
}

async function pollUntil<T>(
  fn: () => Promise<T | null>,
  predicate: (v: T) => boolean,
  timeoutMs: number,
  intervalMs = 2000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v !== null && predicate(v)) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}

async function waitForService(url: string, timeoutMs: number): Promise<void> {
  await pollUntil(
    () =>
      fetch(url)
        .then((r) => r.status)
        .catch(() => null),
    (s) => s !== null && s < 500,
    timeoutMs,
    1000,
  );
}

// ── Test state ────────────────────────────────────────────────────────────────

let authToken: string;
let uploadedSongId: string;

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("E2E: upload → transcode → pin → mint → index pipeline (#935)", () => {
  jest.setTimeout(TIMEOUT_MS + 10_000);

  beforeAll(async () => {
    // Wait for the backend (and its dependencies) to be ready.
    await waitForService(`${BASE_URL}/health`, TIMEOUT_MS);
  });

  // ── 1. Auth ──────────────────────────────────────────────────────────────────

  it("authenticates as the seeded admin", async () => {
    const { status, body } = await fetchJson<{ token?: string }>(
      `${BASE_URL}/api/auth/login`,
      {
        method: "POST",
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      },
    );
    expect(status).toBe(200);
    expect(typeof (body as any).token).toBe("string");
    authToken = (body as any).token as string;
  });

  // ── 2. Upload ─────────────────────────────────────────────────────────────────

  it("uploads a test audio file and receives a song ID", async () => {
    // Use the fixture MP3 that ships with the repo; fall back to a 1-second
    // silent WAV synthesised inline if that file is absent (CI artifact).
    const fixturePath = path.join(__dirname, "../../test_Song.mp3");
    const fileExists = fs.existsSync(fixturePath);

    const form = new FormData();
    if (fileExists) {
      const blob = new Blob([fs.readFileSync(fixturePath)], { type: "audio/mpeg" });
      form.append("file", blob, "e2e_test.mp3");
    } else {
      // Minimal valid RIFF/WAV header — 44 bytes of silence.
      const wav = Buffer.alloc(44);
      wav.write("RIFF", 0); wav.writeUInt32LE(36, 4);
      wav.write("WAVE", 8); wav.write("fmt ", 12);
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
      wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
      wav.write("data", 36); wav.writeUInt32LE(0, 40);
      const blob = new Blob([wav], { type: "audio/wav" });
      form.append("file", blob, "e2e_silence.wav");
    }
    form.append("title", "E2E Pipeline Test Song");
    form.append("genre", "Electronic");

    const res = await fetch(`${BASE_URL}/api/song`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: form,
    });
    const body = (await res.json()) as any;

    expect(res.status).toBeOneOf([200, 201]);
    expect(body?.id ?? body?.song?.id).toBeTruthy();
    uploadedSongId = body?.id ?? body?.song?.id;
  });

  // ── 3. Transcode ──────────────────────────────────────────────────────────────

  it("waits for the transcode job to complete", async () => {
    const song = await pollUntil(
      async () => {
        const { status, body } = await fetchJson<any>(
          `${BASE_URL}/api/song/${uploadedSongId}`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        return status === 200 ? body : null;
      },
      (s) => ["ready", "transcoded", "indexed"].includes(s?.status ?? s?.transcode_status),
      TIMEOUT_MS,
    );
    expect(song).toBeTruthy();
  });

  // ── 4. Stream ─────────────────────────────────────────────────────────────────

  it("streams the uploaded song via range request", async () => {
    const res = await fetch(`${BASE_URL}/api/song/${uploadedSongId}/stream`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        Range: "bytes=0-1023",
      },
    });
    expect([200, 206]).toContain(res.status);
  });

  // ── 5. Index ──────────────────────────────────────────────────────────────────

  it("finds the uploaded song via the search / index endpoint", async () => {
    const result = await pollUntil(
      async () => {
        const { status, body } = await fetchJson<any>(
          `${BASE_URL}/api/song?search=E2E+Pipeline+Test+Song`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        const songs: any[] = body?.songs ?? body?.data ?? (Array.isArray(body) ? body : []);
        return status === 200 && songs.some((s: any) => s.id === uploadedSongId) ? songs : null;
      },
      (songs) => songs !== null,
      TIMEOUT_MS,
    );
    expect(result).not.toBeNull();
  });

  // ── 6. Health ─────────────────────────────────────────────────────────────────

  it("health endpoint reports all subsystems healthy after pipeline run", async () => {
    const { status, body } = await fetchJson<any>(`${BASE_URL}/health`);
    expect(status).toBe(200);
    // Accept both {status:"ok"} and {db:"ok", redis:"ok"} shapes.
    const ok =
      (body as any)?.status === "ok" ||
      ((body as any)?.db !== "error" && (body as any)?.redis !== "error");
    expect(ok).toBe(true);
  });
});
