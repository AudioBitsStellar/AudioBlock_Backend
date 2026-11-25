variable "environment" {
  type = string
}

variable "aws_region" {
  description = "AWS region for CloudWatch log configuration"
  type        = string
  default     = "us-east-1"
}

variable "ecr_image_uri" {
  description = "ECR or GHCR image URI (without tag)"
  type        = string
}

variable "image_tag" {
  description = "Container image tag to deploy"
  type        = string
  default     = "production-latest"
}

variable "acm_certificate_arn" {
  description = "ARN of the ACM certificate for the ALB HTTPS listener"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the ALB"
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for ECS Fargate tasks"
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "Security group ID for the ALB"
  type        = string
}

variable "ecs_api_security_group_id" {
  description = "Security group ID for ECS API tasks"
  type        = string
}

variable "ecs_worker_security_group_id" {
  description = "Security group ID for ECS worker tasks"
  type        = string
}

variable "media_bucket_arn" {
  description = "ARN of the S3 media bucket (used for task IAM policy)"
  type        = string
}

variable "api_desired_count" {
  description = "Desired number of API task replicas"
  type        = number
  default     = 2
}

variable "worker_desired_count" {
  description = "Desired number of song worker task replicas"
  type        = number
  default     = 2
}

variable "tags" {
  type    = map(string)
  default = {}
}
