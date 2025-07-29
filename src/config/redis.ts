import Redis from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD,
  tls: {}, // Redis Cloud requires TLS
});

redis.on("connect", () => {
  console.log("✅ Connected to Redis Cloud");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err);
});

export default redis;
