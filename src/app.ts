import cookieParser from "cookie-parser";
import express, {
  Request,
  Response,
  RequestHandler,
  ErrorRequestHandler,
} from "express";
import morgan from "morgan";
import cors from "cors";
import redis from "./config/redis";
import authRoutes from "./routes/authRoutes";
import artistRoutes from "./routes/artistRoutes";
import twitterRoutes from "./routes/twitterRoutes";
import walletRoutes from "./routes/walletRoutes";
import SongRoutes from "./routes/SongRoutes";
import marketplaceRoutes from "./routes/marketplaceRoutes";
import adminRoutes from "./routes/adminRoutes";


// Route imports

// Initialize express app
const app = express();

// Apply middleware
// Apply global middlewares
app.use(cookieParser());
app.use(morgan("dev"));

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

// Admin moderation routes
app.use("/api/admin", adminRoutes);


//TWITTER CALLBACK ROUTE
app.use("/api/auth/twitter", twitterRoutes);


app.get('/redis-test', async (req, res) => {
  await redis.set('greeting', 'hello world');
  const value = await redis.get('greeting');
  res.send({ value });
});


// Error handling middleware
const customErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  console.error("Unhandled error:", err);
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
  console.log("404 - Route not found:", req.originalUrl);
  res.status(404).json({
    error: "error",
    message: `Route ${req.originalUrl} not found`,
  });
}) as RequestHandler);

// Export app
export default app;
