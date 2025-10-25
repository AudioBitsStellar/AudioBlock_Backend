/**
 * Simulate full song upload (chunked) + cover + finalize to your AudioBlocks backend
 */

import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import path from "path";

const API_BASE = "http://localhost:4000/api/song/upload";
const AUTH_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImMxYTMxNjIwLTk5ZjQtNGQ1Zi05OGQxLWQ4N2VkOGU3OTBkNyIsImR5bmFtaXhVc2VySWQiOiIxZGE3MzY5Mi1lYzE1LTRiNTctOTg5ZS1lNGQwZmM0NjViNjciLCJlbWFpbCI6ImV6ZW96dWVjaGlhZ296aWVtQGdtYWlsLmNvbSIsIndhbGxldEFkZHJlc3MiOiIweEIwODZjRjk4OTc0MWU4NmI1MzU0NzA5NjYxMjBlQUNDMmI5RkY3OTkiLCJyb2xlIjoiYXJ0aXN0IiwidXNlcm5hbWUiOiJndXpieXRlXzIiLCJwcm9maWxlSW1hZ2UiOm51bGwsIm5hbWUiOm51bGwsInJld2FyZFBvaW50cyI6MCwidG90YWxTdHJlYW1zIjowLCJ0b3RhbFN0cmVhbVRpbWUiOjAsInVuaXF1ZUxpc3RlbmVycyI6MCwiaWF0IjoxNzYxMzU4MDcwLCJleHAiOjE3NjE0NDQ0NzB9.037q2iqtonpoMKxHVe6k1Dx5UDgNXkJ1x9CGck683VY"; // Replace with a valid artist token
const FILE_ID = crypto.randomUUID() + "abc123"; // Unique identifier per upload session

const SONG_PATH = "./test_song.mp3"; // Your local audio file
const COVER_PATH = "./cover.jpg"; // Your cover art image
const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB per chunk
let coverArtPath = "";

/**
 * Split file into smaller chunks
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
    console.log(`✅ Uploaded chunk ${chunkIndex}:`, res.data.success);
  } catch (err) {
    console.error(
      `❌ Failed to upload chunk ${chunkIndex}:`,
      err.response?.data || err.message
    );
    process.exit(1);
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
    console.log("✅ Uploaded cover art", res.data);
    console.log("🖼️ Cover uploaded:", res.data.message);
  } catch (err) {
    console.error("❌ Cover upload failed:", err.response?.data || err.message);
    process.exit(1);
  }
}

/**
 * Finalize upload
 */
async function finalizeUpload(fileId, totalChunks, title = "My Test Song") {
  try {
    const genre = "Pop"; // Example genre
    const description = "This is a test song upload."; // Example description
    const coverr = coverArtPath;
    const res = await axios.post(
      `${API_BASE}/finalize`,
      { fileId, totalChunks, title, coverArtPath: coverr, description, genre },
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }
    );
    console.log("🎵 Finalize response:", res.data);
  } catch (err) {
    console.error("❌ Finalize failed:", err.response?.data || err.message);
    process.exit(1);
  }
}

/**
 * Main Simulation Runner
 */
async function simulateUpload() {
  console.log("🚀 Starting chunked upload simulation...");

  // 1️⃣ Split the audio file
  const chunks = splitFile(SONG_PATH, CHUNK_SIZE);
  console.log(`🔹 Total chunks: ${chunks.length}`);

  // 2️⃣ Upload chunks sequentially
  for (let i = 0; i < chunks.length; i++) {
    await uploadChunk(FILE_ID, i, chunks[i]);
  }

  // 3️⃣ Upload cover
  await uploadCover(FILE_ID, COVER_PATH);

  // 4️⃣ Finalize upload
  await finalizeUpload(FILE_ID, chunks.length);

  console.log("✅ All done!");
}

simulateUpload();
