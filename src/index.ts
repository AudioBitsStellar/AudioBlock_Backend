import "reflect-metadata";
import app from "./app";
import AppDataSource from "./config/db";
import { initRabbitMQ, waitForRabbitMQ } from "./config/rabbitmq";
import { startSongWorker } from "./workers/SongProcessorWorker";
import fs from "fs";
import path from "path";
import { runSeeders } from "./seeders";

// Ensure upload directories exist
const uploadDirs = ["uploads/temp", "uploads/merged", "uploads/profile-images",
  "uploads/page-covers", "uploads/covers"];

async function main() {
  try {
    // Initialize the database connection
    await AppDataSource.initialize();
    console.log("✅ Database connected successfully");


    // Run Seeders
    await runSeeders();

    initRabbitMQ();
    await waitForRabbitMQ();
    console.log("✅ RabbitMQ is ready");

    // Start the server
    const PORT = process.env.PORT || 4000;
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server is listening on port ${PORT}`);
    });

    // Start background workers
    startSongWorker();
    console.log("✅ Background workers started");

    uploadDirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
      }
    });

    // Handle server startup errors
    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        console.error(`❌ Port ${PORT} is already in use`);
        console.log("💡 Try running: lsof -ti:4000 | xargs kill -9");
      } else {
        console.error("❌ Server error:", error);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error("❌ Failed to start the server:", error);
    process.exit(1); // Exit the process if the database fails to initialize
  }
}

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

main();
