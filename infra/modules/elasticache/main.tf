resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.environment}-redis-subnets"
  subnet_ids = var.subnet_ids

  tags = merge(var.tags, {
    Name = "${var.environment}-redis-subnets"
  })
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "${var.environment}-redis"
  description                = "AudioBlocks Redis cluster (${var.environment})"
  node_type                  = var.node_type
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  engine_version             = var.engine_version
  port                       = 6379
  parameter_group_name       = "default.redis7"
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [var.security_group_id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = var.auth_token
  auth_token_update_strategy = "ROTATE"

  # 15-minute RDB snapshot for DR (see docs/runbooks/disaster-recovery.md §Redis loss)
  snapshot_retention_limit = 1
  snapshot_window          = "03:00-04:00"

  # volatile-lru prevents cache eviction from displacing durable job keys
  # Operators must set maxmemory-policy = volatile-lru in the parameter group
  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  tags = merge(var.tags, {
    Name = "${var.environment}-redis"
  })
}

resource "aws_cloudwatch_log_group" "redis" {
  name              = "/audioblocks/${var.environment}/redis"
  retention_in_days = 30

  tags = var.tags
}
