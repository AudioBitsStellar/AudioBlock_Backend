import cookieParser from "cookie-parser";
import express, {
  Request,
  Response,
  RequestHandler,
  ErrorRequestHandler,
} from "express";
import logger from "./config/logger";
import { requestLoggerMiddleware } from "./middlewares/requestLogger";
import cors from "cors";
import redis from "./config/redis";
import authRoutes from "./routes/authRoutes";
import artistRoutes from "./routes/artistRoutes";
import twitterRoutes from "./routes/twitterRoutes";
import walletRoutes from "./routes/walletRoutes";
import SongRoutes from "./routes/SongRoutes";
import marketplaceRoutes from "./routes/marketplaceRoutes";
import adminRoutes from "./routes/adminRoutes";
import webhookRoutes from "./routes/webhookRoutes";
import takedownRoutes from "./routes/takedownRoutes";
import embedRoutes from "./routes/embedRoutes";
import royaltyPayoutRoutes from "./routes/royaltyPayoutRoutes";
import playlistRoutes from "./routes/playlistRoutes";
import userRoutes from "./routes/userRoutes";

// Route imports

// Initialize express app
const app = express();

// Apply middleware
// Apply global middlewares
app.use(cookieParser());
// Structured request logging with correlation id (Issue #33)
app.use(requestLoggerMiddleware);

// CORS configuration
// In production set ALLOWED_ORIGINS to a comma-separated list of the deployed
// listener-app and artist-dashboard domains, e.g.:
//   ALLOWED_ORIGINS=https://listener.audioblockz.com,https://artist.audioblockz.com
const allowedOrigins: string[] = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:5500"];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Access-Control-Request-Method",
      "Access-Control-Request-Headers",
    ],
    exposedHeaders: ["Authorization"],
    maxAge: 86400, // 24 hours
  }),
);

app.use(express.json());


// Add timeout configurations
app.use((req, res, next) => {
  req.setTimeout(30000); // 30 seconds
  res.setTimeout(30000); // 30 seconds
  next();
});



// Log application startup


// Define routes
app.use("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/artist", artistRoutes);

// Dynamic wallet routes
app.use("/api/wallet", walletRoutes);

// Song wallet
app.use("/api/song", SongRoutes);

// Marketplace Soroban relay (list + buy)
app.use("/api/marketplace", marketplaceRoutes);

// Royalty payouts
app.use("/api/royalty-payouts", royaltyPayoutRoutes);

// Admin moderation routes
app.use("/api/admin", adminRoutes);

// Webhook subscriptions (third-party event delivery)
app.use("/api/webhooks", webhookRoutes);

// Copyright takedown workflow (distinct from general moderation)
app.use("/api/takedown", takedownRoutes);

// Embeddable player (public, no auth)
app.use("/api/embed", embedRoutes);


// Playlists (Issue #77) + collaborative editing (#406) + smart playlists (#407)
app.use("/api/playlists", playlistRoutes);

// User routes
app.use("/api/users", userRoutes);


//TWITTER CALLBACK ROUTE
app.use("/api/auth/twitter", twitterRoutes);


// Error handling middleware
const customErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  logger.error(
    { reqId: (req as any).id, err, route: req.originalUrl, method: req.method },
    "Unhandled error"
  );

  // Multer file-size limit exceeded
  if (err.name === "MulterError" && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: "Payload Too Large",
      message: "Uploaded file exceeds the maximum allowed size.",
    });
  }

  // Other multer errors (file filter rejections, unexpected fields, etc.)
  if (err.name === "MulterError") {
    return res.status(400).json({
      error: "Bad Request",
      message: err.message,
    });
  }

  // File filter rejection errors are passed as plain Error through Express
  if (err instanceof Error && /Invalid file type|allowed/i.test(err.message)) {
    return res.status(400).json({
      error: "Bad Request",
      message: err.message,
    });
  }

  res.status(500).json({
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
  });
};

app.use(customErrorHandler);

// Handle 404 errors
app.use(((req: Request, res: Response) => {
  logger.warn({ reqId: (req as any).id, route: req.originalUrl }, "404 - Route not found");
  res.status(404).json({
    error: "error",
    message: `Route ${req.originalUrl} not found`,
  });
}) as RequestHandler);

// Export app
export default app;
