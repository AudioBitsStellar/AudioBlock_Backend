variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "cloudflare_ipv4_ranges" {
  description = "Cloudflare IPv4 CIDR ranges allowed to reach the ALB"
  type        = list(string)
  # Keep in sync with https://www.cloudflare.com/ips-v4
  default = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22"
  ]
}

variable "media_bucket_name" {
  description = "Name of the S3 media bucket"
  type        = string
  default     = "audioblocks-prod-media"
}

variable "kms_key_arn" {
  description = "ARN of the KMS CMK for S3 SSE-KMS encryption"
  type        = string
  default     = ""
}

variable "replica_bucket_arn" {
  description = "ARN of the destination bucket for S3 cross-region replication (DR)"
  type        = string
  default     = ""
}

variable "ecr_image_uri" {
  description = "Container image URI (without tag)"
  type        = string
}

variable "image_tag" {
  description = "Container image tag to deploy"
  type        = string
  default     = "production-latest"
}

variable "acm_certificate_arn" {
  description = "ARN of the ACM certificate for the production ALB HTTPS listener"
  type        = string
}
