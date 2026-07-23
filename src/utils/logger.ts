import pino from "pino";

const level =
  process.env.LOG_LEVEL ||
  (process.env.NODE_ENV === "production" ? "info" : "debug");

// pino-http's default req/res serializers log headers verbatim, so
// credential-bearing headers must be censored here.
const logger = pino({
  level,
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    'res.headers["set-cookie"]',
  ],
});

export default logger;
