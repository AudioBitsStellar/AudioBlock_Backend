// import ffmpeg from "fluent-ffmpeg";
// import fs from "fs";
// import path from "path";

// export async function transcodeToHLS(inputPath: string, outputDir: string): Promise<void> {
//   if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

//   return new Promise((resolve, reject) => {
//     ffmpeg(inputPath)
//       .outputOptions([
//         "-codec: copy",
//         "-start_number 0",
//         "-hls_time 10",
//         "-hls_list_size 0",
//         "-f hls",
//       ])
//       .output(path.join(outputDir, "master.m3u8"))
//       .on("end", () => resolve())
//       .on("error", reject)
//       .run();
//   });
// }


import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";

/**
 * Transcodes an MP3 (or any audio) file into HLS format:
 * - Creates 10s .ts chunks
 * - Generates master.m3u8 playlist
 */
export async function transcodeToHLS(inputPath: string, outputDir: string): Promise<void> {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      // copy codec (no re-encoding — much faster)
      .outputOptions([
        "-codec: copy",
        "-start_number 0",
        "-hls_time 10",      // 10s per segment
        "-hls_list_size 0",  // include all segments
        "-f hls",            // output format
      ])
      .output(path.join(outputDir, "master.m3u8"))
      .on("end", () => {
        console.log("✅ HLS transcoding complete:", outputDir);
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ FFmpeg error:", err);
        reject(err);
      })
      .run();
  });
}
