variable "environment" {
  type = string
}

variable "engine_version" {
  description = "Aurora PostgreSQL engine version"
  type        = string
  default     = "15.4"
}

variable "database_name" {
  description = "Initial database name"
  type        = string
  default     = "audioblocks"
}

variable "master_username" {
  description = "Master DB username (password managed by RDS Secrets Manager integration)"
  type        = string
  default     = "audioblocks"
}

variable "min_capacity" {
  description = "Minimum Aurora Serverless v2 ACU capacity"
  type        = number
  default     = 0.5
}

variable "max_capacity" {
  description = "Maximum Aurora Serverless v2 ACU capacity"
  type        = number
  default     = 16
}

variable "security_group_id" {
  description = "Security group ID for the Aurora cluster"
  type        = string
}

variable "subnet_ids" {
  description = "List of subnet IDs for the DB subnet group (isolated subnets)"
  type        = list(string)
}

variable "create_global_cluster" {
  description = "Whether to create a global Aurora cluster (for multi-region DR)"
  type        = bool
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
