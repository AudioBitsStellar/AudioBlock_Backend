/**
 * Simulate full song upload (chunked) + cover + finalize
 */

import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import crypto from "crypto";

const API_BASE = "http://localhost:4000/api/song/upload";
const AUTH_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImMxYTMxNjIwLTk5ZjQtNGQ1Zi05OGQxLWQ4N2VkOGU3OTBkNyIsImR5bmFtaXhVc2VySWQiOiIxZGE3MzY5Mi1lYzE1LTRiNTctOTg5ZS1lNGQwZmM0NjViNjciLCJlbWFpbCI6ImV6ZW96dWVjaGlhZ296aWVtQGdtYWlsLmNvbSIsIndhbGxldEFkZHJlc3MiOiIweEIwODZjRjk4OTc0MWU4NmI1MzU0NzA5NjYxMjBlQUNDMmI5RkY3OTkiLCJyb2xlIjoiYXJ0aXN0IiwidXNlcm5hbWUiOiJndXpieXRlXzIiLCJwcm9maWxlSW1hZ2UiOm51bGwsIm5hbWUiOm51bGwsInJld2FyZFBvaW50cyI6MCwidG90YWxTdHJlYW1zIjowLCJ0b3RhbFN0cmVhbVRpbWUiOjAsInVuaXF1ZUxpc3RlbmVycyI6MCwiaWF0IjoxNzYxNjA1MDU1LCJleHAiOjE3NjE2OTE0NTV9.ZASaMBzvk3iX7MYWicLgiVD4gutILqEW_lNy-31QAew"; // Replace with valid token

const SONG_PATH = "./test_song.mp3";
const COVER_PATH = "./cover.jpg";
const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB per chunk

let coverArtPath = "";

/**
 * Split file into chunks
 */
function splitFile(filePath, chunkSize) {
  const buffer = fs.readFileSync(filePath);
  const totalChunks = Math.ceil(buffer.length / chunkSize);
  const chunks = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, buffer.length);
    const chunk = buffer.slice(start, end);
    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Upload a single chunk
 */
async function uploadChunk(fileId, chunkIndex, chunk) {
  const form = new FormData();
  form.append("fileId", fileId);
  form.append("chunkIndex", chunkIndex);
  form.append("chunk", chunk, `chunk_${chunkIndex}.mp3`);

  try {
    const res = await axios.post(`${API_BASE}/chunk`, form, {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        ...form.getHeaders(),
      },
    });
    console.log(`✅ Uploaded chunk ${chunkIndex}`);
  } catch (err) {
    console.error(
      `❌ Failed chunk ${chunkIndex}:`,
      err.response?.data || err.message
    );
    throw err;
  }
}

/**
 * Upload cover art
 */
async function uploadCover(fileId, coverPath) {
  const form = new FormData();
  form.append("fileId", fileId);
  form.append("cover", fs.createReadStream(coverPath));

  try {
    const res = await axios.post(`${API_BASE}/cover`, form, {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        ...form.getHeaders(),
      },
    });
    coverArtPath = res.data.data.cover;
    console.log("✅ Cover uploaded:", coverArtPath);
  } catch (err) {
    console.error("❌ Cover upload failed:", err.response?.data || err.message);
    throw err;
  }
}

/**
 * Finalize upload
 */
async function finalizeUpload(fileId, totalChunks, metadata) {
  try {
    const res = await axios.post(
      `${API_BASE}/finalize`,
      {
        fileId,
        totalChunks,
        title: metadata.title,
        coverArtPath: metadata.coverArtPath,
        description: metadata.description,
        genre: metadata.genre,
      },
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }
    );
    console.log("🎵 Upload finalized:", res.data);
  } catch (err) {
    console.error("❌ Finalize failed:", err.response?.data || err.message);
    throw err;
  }
}

/**
 * Main execution
 */
async function simulateUpload() {
  const fileId = crypto.randomUUID();
  console.log("🚀 Starting upload with fileId:", fileId);

  try {
    // 1. Split and upload chunks
    const chunks = splitFile(SONG_PATH, CHUNK_SIZE);
    console.log(`📦 Total chunks: ${chunks.length}`);

    for (let i = 0; i < chunks.length; i++) {
      await uploadChunk(fileId, i, chunks[i]);
    }

    // 2. Upload cover
    await uploadCover(fileId, COVER_PATH);

    // 3. Finalize
    await finalizeUpload(fileId, chunks.length, {
      title: "My Test Song",
      coverArtPath,
      description: "This is a test upload",
      genre: "Pop",
    });

    console.log("✅ Upload complete!");
  } catch (error) {
    console.error("❌ Upload failed:", error.message);
    process.exit(1);
  }
}

simulateUpload();
