import { Application } from "express";
import logger from "../config/logger";

export interface DispatchRequest {
  method: string;
  path: string;
  body?: unknown;
}

export interface DispatchResponse {
  status: number;
  body: unknown;
}

const DISPATCH_TIMEOUT_MS = 30_000;

export class BatchService {
  private app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  async dispatch(
    subReq: DispatchRequest,
    parentHeaders: Record<string, string | string[] | undefined>
  ): Promise<DispatchResponse> {
    return new Promise<DispatchResponse>((resolve) => {
      const timer = setTimeout(() => {
        logger.warn({ method: subReq.method, path: subReq.path }, "Sub-request timed out");
        resolve({ status: 504, body: { error: "Sub-request timed out" } });
      }, DISPATCH_TIMEOUT_MS);

      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(parentHeaders)) {
        if (typeof v === "string") headers[k] = v;
      }
      headers["content-type"] = "application/json";
      headers["accept"] = "application/json";

      const req: any = {
        method: subReq.method.toUpperCase(),
        url: subReq.path,
        path: subReq.path.split("?")[0],
        headers,
        body: subReq.body,
        query: Object.fromEntries(new URL(subReq.path, "http://localhost").searchParams),
        params: {},
        originalUrl: subReq.path,
        ip: "127.0.0.1",
        secure: false,
        protocol: "http",
        hostname: "localhost",
      };

      const res: any = {
        statusCode: 200,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(data: unknown) {
          clearTimeout(timer);
          resolve({ status: this.statusCode, body: data });
          return this;
        },
        send(data: unknown) {
          clearTimeout(timer);
          resolve({ status: this.statusCode, body: data });
          return this;
        },
        end(data?: unknown) {
          clearTimeout(timer);
          resolve({ status: this.statusCode, body: data ?? null });
          return this;
        },
        setHeader() {
          return this;
        },
        getHeaders() {
          return {};
        },
      };

      this.app.handle(req, res);
    });
  }
}
