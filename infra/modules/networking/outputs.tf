output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of the private (application) subnets"
  value       = aws_subnet.private[*].id
}

output "database_subnet_ids" {
  description = "IDs of the isolated database subnets"
  value       = aws_subnet.database[*].id
}

output "alb_security_group_id" {
  description = "Security group ID for the Application Load Balancer"
  value       = aws_security_group.alb.id
}

output "ecs_api_security_group_id" {
  description = "Security group ID for ECS API tasks"
  value       = aws_security_group.ecs_api.id
}

output "ecs_worker_security_group_id" {
  description = "Security group ID for ECS worker tasks"
  value       = aws_security_group.ecs_worker.id
}

output "database_security_group_id" {
  description = "Security group ID for Aurora PostgreSQL"
  value       = aws_security_group.database.id
}

output "redis_security_group_id" {
  description = "Security group ID for ElastiCache Redis"
  value       = aws_security_group.redis.id
}

output "mq_security_group_id" {
  description = "Security group ID for Amazon MQ"
  value       = aws_security_group.mq.id
}
