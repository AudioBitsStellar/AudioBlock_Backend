variable "environment" {
  description = "Deployment environment name"
  type        = string
}

variable "bucket_name" {
  description = "Name of the S3 media bucket"
  type        = string
}

variable "kms_key_arn" {
  description = "ARN of the KMS key for SSE-KMS (leave empty to use AES256)"
  type        = string
  default     = ""
}

variable "replica_bucket_arn" {
  description = "ARN of the destination bucket for cross-region replication (leave empty to disable)"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Common resource tags"
  type        = map(string)
  default     = {}
}
