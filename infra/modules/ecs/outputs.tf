output "cluster_id" {
  description = "ECS cluster ID"
  value       = aws_ecs_cluster.main.id
}

output "cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Route53 hosted zone ID of the ALB (for alias records)"
  value       = aws_lb.main.zone_id
}

output "api_service_name" {
  description = "ECS service name for the API"
  value       = aws_ecs_service.api.name
}

output "worker_service_name" {
  description = "ECS service name for the song worker"
  value       = aws_ecs_service.worker.name
}
