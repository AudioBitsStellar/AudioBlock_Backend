variable "environment" {
  description = "Deployment environment name (staging or production)"
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'"
  }
}

variable "cidr_block" {
  description = "CIDR block for the VPC (e.g. 10.0.0.0/16)"
  type        = string
}

variable "cloudflare_ipv4_ranges" {
  description = "List of Cloudflare IPv4 CIDR ranges allowed to reach the ALB (see docs/WAF_DDOS_PROTECTION.md)"
  type        = list(string)
}

variable "tags" {
  description = "Common resource tags applied to all resources"
  type        = map(string)
  default     = {}
}
