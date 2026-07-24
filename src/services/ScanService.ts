/**
 * ScanService – virus/malware scanning step for uploaded audio (Issue #38)
 *
 * Integrates a ClamAV-compatible scanning layer into the upload pipeline.
 * The implementation supports two strategies, selected via SCAN_PROVIDER:
 *
 *   "clamav" (default) – calls a ClamAV REST sidecar (clamd-rest) running
 *                         alongside the backend container.  Endpoint is
 *                         configurable via CLAMAV_URL.
 *
 *   "skip"             – disables scanning entirely (dev / test only).
 *                         NEVER use in production.
 *
 * Scan results:
 *   { clean: true }                       – file is safe; upload may proceed
 *   { clean: false, threat: "<name>" }    – file is flagged; caller must
 *                                           reject the upload and notify the
 *                                           artist (HTTP 422).
 *
 * Usage (in UploadController.finalizeUpload):
 *   const result = await ScanService.scanFile(localPath);
 *   if (!result.clean) {
 *     // delete the temp file and return 422 to the artist
 *   }
 *
 * See also: docs/scanning.md for deployment guide and ClamAV sidecar config.
 */
import fs from "fs";
import path from "path";
import FormData from "form-data";
import axios from "axios";
import logger from "../config/logger";

export interface ScanResult {
  clean: boolean;
  threat?: string;
}

export class ScanService {
  private static readonly provider =
    (process.env.SCAN_PROVIDER || "clamav").toLowerCase();

  private static readonly clamavUrl =
    process.env.CLAMAV_URL || "http://localhost:9000/scan";

  /**
   * Scan a local file for malware.
   *
   * @param filePath  Absolute or relative path to the file to scan.
   * @returns         ScanResult — callers must check `clean` before proceeding.
   * @throws          If the scanning service is unavailable and the provider is
   *                  not "skip".  Callers should treat an unexpected throw as an
   *                  error and reject the upload rather than silently passing it.
   */
  static async scanFile(filePath: string): Promise<ScanResult> {
    if (ScanService.provider === "skip") {
      logger.warn(
        { filePath },
        "SCAN_PROVIDER=skip — malware scanning is disabled. Do not use in production."
      );
      return { clean: true };
    }

    logger.info({ filePath, provider: ScanService.provider }, "Starting malware scan");

    try {
      const form = new FormData();
      form.append("file", fs.createReadStream(filePath), {
        filename: path.basename(filePath),
      });

      const response = await axios.post<{ status: string; virus?: string }>(
        ScanService.clamavUrl,
        form,
        {
          headers: form.getHeaders(),
          // Scanning large audio files can take a few seconds
          timeout: parseInt(process.env.CLAMAV_TIMEOUT_MS || "30000", 10),
        }
      );

      const { status, virus } = response.data;

      if (status === "FOUND" || status === "ERROR") {
        const threat = virus ?? "unknown";
        logger.warn({ filePath, threat }, "Malware detected in uploaded file");
        return { clean: false, threat };
      }

      logger.info({ filePath }, "Malware scan passed — file is clean");
      return { clean: true };
    } catch (err: any) {
      // If the scanner is unavailable we FAIL CLOSED — reject the upload
      logger.error({ filePath, err }, "Malware scanner unreachable — rejecting upload");
      throw new Error(
        `Malware scanning service is unavailable. Upload rejected. (${err.message})`
      );
    }
  }
}
