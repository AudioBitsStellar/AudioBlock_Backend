output "amqp_endpoint" {
  description = "AMQP (non-TLS) endpoint for the RabbitMQ broker"
  value       = aws_mq_broker.main.instances[0].endpoints[0]
}

output "amqps_endpoint" {
  description = "AMQPS (TLS) endpoint for the RabbitMQ broker"
  value       = aws_mq_broker.main.instances[0].endpoints[1]
}

output "broker_arn" {
  description = "ARN of the Amazon MQ broker"
  value       = aws_mq_broker.main.arn
}
