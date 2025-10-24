import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";

export async function transcodeToHLS(inputPath: string, outputDir: string): Promise<void> {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-codec: copy",
        "-start_number 0",
        "-hls_time 10",
        "-hls_list_size 0",
        "-f hls",
      ])
      .output(path.join(outputDir, "master.m3u8"))
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}
