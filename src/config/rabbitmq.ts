import amqp from "amqplib";

let channel: amqp.Channel | null = null;

export async function initRabbitMQ(): Promise<void> {
  const connect = async () => {
    try {
      const connection = await amqp.connect({
        protocol: "amqp",
        hostname: process.env.RABBITMQ_HOST || "rabbitmq",
        port: parseInt(process.env.RABBITMQ_PORT || "5672"),
        username: process.env.RABBITMQ_USER || "guest",
        password: process.env.RABBITMQ_PASS || "guest",
      });

      channel = await connection.createChannel();
      console.log("✅ RabbitMQ connected and channel created");

      // Handle connection close events
      connection.on("close", () => {
        console.error("⚠️ RabbitMQ connection closed. Retrying...");
        channel = null;
        setTimeout(connect, 5000);
      });
    } catch (error: any) {
      console.error("❌ RabbitMQ connection failed:", error.message);
      channel = null;
      setTimeout(connect, 5000); // retry after 5 seconds
    }
  };

  await connect();
}

export async function waitForRabbitMQ(): Promise<void> {
  let retries = 0;
  while (!channel) {
    retries++;
    console.log(`⏳ Waiting for RabbitMQ... (attempt ${retries})`);
    await new Promise((res) => setTimeout(res, 2000));
  }
}

export function getChannel(): amqp.Channel {
  if (!channel) throw new Error("RabbitMQ not initialized");
  return channel;
}
