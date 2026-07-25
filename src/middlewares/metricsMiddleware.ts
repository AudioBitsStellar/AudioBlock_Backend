import { Request, Response, NextFunction, RequestHandler } from "express";
import {
  httpRequestsTotal,
  httpRequestDurationSeconds,
  httpRequestsActive,
} from "../services/MetricsService";

export const metricsMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (req.path === "/metrics") {
    return next();
  }

  httpRequestsActive.inc();
  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const route = req.route?.path || req.originalUrl?.split("?")[0] || req.path;

    httpRequestsTotal.inc({ method: req.method, route, status: res.statusCode });
    httpRequestDurationSeconds.observe(
      { method: req.method, route, status: res.statusCode },
      durationMs / 1000
    );
    httpRequestsActive.dec();
  });

  next();
};
