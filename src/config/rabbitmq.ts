import amqp from "amqplib";

let channel: amqp.Channel;

export async function initRabbitMQ() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL!);
  channel = await connection.createChannel();
  await channel.assertQueue("song_processing");
  console.log("✅ RabbitMQ connected");
}

export function getChannel() {
  if (!channel) throw new Error("RabbitMQ not initialized");
  return channel;
}
