variable "environment" {
  type = string
}

variable "node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.small"
}

variable "engine_version" {
  description = "Redis engine version"
  type        = string
  default     = "7.1"
}

variable "auth_token" {
  description = "AUTH token for Redis (read from Secrets Manager in the caller)"
  type        = string
  sensitive   = true
}

variable "security_group_id" {
  description = "Security group ID restricting Redis access to ECS tasks only"
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs for the ElastiCache subnet group"
  type        = list(string)
}

variable "tags" {
  type    = map(string)
  default = {}
}
