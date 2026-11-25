# AudioBlocks Infrastructure as Code

This directory contains **Terraform** configuration for all AudioBlocks
environments. It is the single authoritative source of truth for infrastructure;
manual changes to AWS resources are not permitted in production.

## Directory Structure

```
infra/
├── README.md               # This file
├── modules/                # Reusable child modules
│   ├── networking/         # VPC, subnets, security groups, NAT gateways
│   ├── ecs/                # ECS cluster, services, task definitions
│   ├── rds/                # Aurora PostgreSQL cluster
│   ├── elasticache/        # Redis (ElastiCache)
│   ├── mq/                 # Amazon MQ (RabbitMQ)
│   └── s3/                 # S3 buckets, lifecycle rules, replication
└── environments/
    ├── staging/            # Staging (Stellar Testnet)
    │   ├── main.tf
    │   ├── variables.tf
    │   └── terraform.tfvars.example
    └── production/         # Production (Stellar Mainnet)
        ├── main.tf
        ├── variables.tf
        └── terraform.tfvars.example
```

## Prerequisites

- Terraform >= 1.6
- AWS CLI configured with appropriate credentials/role
- Access to the shared Terraform state S3 bucket and DynamoDB lock table

## Usage

```bash
# Navigate to the target environment
cd infra/environments/staging

# Initialise (downloads providers, configures remote state)
terraform init

# Preview changes
terraform plan

# Apply changes (requires explicit approval in CI or manual confirmation)
terraform apply
```

## Remote State

State is stored in S3 with DynamoDB locking:

| Environment | S3 Bucket | DynamoDB Table | Region |
| --- | --- | --- | --- |
| staging | `audioblocks-tf-state-staging` | `audioblocks-tf-locks-staging` | `us-east-1` |
| production | `audioblocks-tf-state-prod` | `audioblocks-tf-locks-prod` | `us-east-1` |

The bootstrap configuration for the state bucket itself lives in
`infra/bootstrap/` and is applied once manually by the Platform Lead.

## Secrets

No secret values are stored in this repository. All secrets are referenced from
**AWS Secrets Manager** using the `aws_secretsmanager_secret_version` data
source and injected into ECS task definitions at runtime. See
`modules/ecs/task_definition.tf` for the pattern.

## CI

A `terraform plan` runs automatically on every pull request (see
`.github/workflows/terraform.yml`). The plan output is posted as a PR comment.
`terraform apply` requires a manual approval step in the GitHub Actions
environment and is restricted to the `main` branch.
