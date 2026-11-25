variable "environment" {
  type = string
}

variable "engine_version" {
  description = "RabbitMQ engine version"
  type        = string
  default     = "3.13"
}

variable "instance_type" {
  description = "Amazon MQ broker instance type"
  type        = string
  default     = "mq.m5.large"
}

variable "mq_username" {
  description = "RabbitMQ admin username"
  type        = string
}

variable "mq_password" {
  description = "RabbitMQ admin password (read from Secrets Manager in the caller)"
  type        = string
  sensitive   = true
}

variable "security_group_id" {
  description = "Security group ID restricting MQ access to ECS tasks only"
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs (two AZs required for CLUSTER_MULTI_AZ)"
  type        = list(string)
}

variable "tags" {
  type    = map(string)
  default = {}
}
