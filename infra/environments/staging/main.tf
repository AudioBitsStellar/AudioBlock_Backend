terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "audioblocks-tf-state-staging"
    key            = "staging/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "audioblocks-tf-locks-staging"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "audioblocks"
      Environment = "staging"
      ManagedBy   = "terraform"
    }
  }
}

module "networking" {
  source = "../../modules/networking"

  environment            = "staging"
  cidr_block             = var.vpc_cidr
  cloudflare_ipv4_ranges = var.cloudflare_ipv4_ranges
}

module "s3" {
  source = "../../modules/s3"

  environment  = "staging"
  bucket_name  = var.media_bucket_name
}

module "rds" {
  source = "../../modules/rds"

  environment       = "staging"
  security_group_id = module.networking.database_security_group_id
  subnet_ids        = module.networking.database_subnet_ids
  min_capacity      = 0.5
  max_capacity      = 4
}

data "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id = "${var.environment}/audioblocks/redis-auth-token"
}

module "elasticache" {
  source = "../../modules/elasticache"

  environment       = "staging"
  node_type         = "cache.t4g.small"
  auth_token        = data.aws_secretsmanager_secret_version.redis_auth.secret_string
  security_group_id = module.networking.redis_security_group_id
  subnet_ids        = module.networking.private_subnet_ids
}

data "aws_secretsmanager_secret_version" "mq_password" {
  secret_id = "${var.environment}/audioblocks/mq-password"
}

module "mq" {
  source = "../../modules/mq"

  environment       = "staging"
  instance_type     = "mq.m5.large"
  mq_username       = "audioblocks"
  mq_password       = data.aws_secretsmanager_secret_version.mq_password.secret_string
  security_group_id = module.networking.mq_security_group_id
  subnet_ids        = slice(module.networking.private_subnet_ids, 0, 2)
}

module "ecs" {
  source = "../../modules/ecs"

  environment                  = "staging"
  aws_region                   = var.aws_region
  ecr_image_uri                = var.ecr_image_uri
  image_tag                    = var.image_tag
  acm_certificate_arn          = var.acm_certificate_arn
  vpc_id                       = module.networking.vpc_id
  public_subnet_ids            = module.networking.public_subnet_ids
  private_subnet_ids           = module.networking.private_subnet_ids
  alb_security_group_id        = module.networking.alb_security_group_id
  ecs_api_security_group_id    = module.networking.ecs_api_security_group_id
  ecs_worker_security_group_id = module.networking.ecs_worker_security_group_id
  media_bucket_arn             = module.s3.bucket_arn
  api_desired_count            = 1
  worker_desired_count         = 1
}
