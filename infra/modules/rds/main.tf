resource "aws_rds_global_cluster" "main" {
  count = var.create_global_cluster ? 1 : 0

  global_cluster_identifier = "${var.environment}-aurora-global"
  engine                    = "aurora-postgresql"
  engine_version            = var.engine_version
  storage_encrypted         = true
}

resource "aws_rds_cluster" "main" {
  cluster_identifier              = "${var.environment}-aurora"
  engine                          = "aurora-postgresql"
  engine_mode                     = "provisioned"
  engine_version                  = var.engine_version
  database_name                   = var.database_name
  master_username                 = var.master_username
  manage_master_user_password     = true
  port                            = 5432
  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [var.security_group_id]
  storage_encrypted               = true
  backup_retention_period         = 30
  preferred_backup_window         = "01:00-02:00"
  preferred_maintenance_window    = "sun:03:00-sun:04:00"
  copy_tags_to_snapshot           = true
  deletion_protection             = var.environment == "production"
  enabled_cloudwatch_logs_exports = ["postgresql"]
  storage_type                    = "aurora-iopt1"
  serverlessv2_scaling_configuration {
    min_capacity = var.min_capacity
    max_capacity = var.max_capacity
  }

  tags = merge(var.tags, {
    Name = "${var.environment}-aurora-cluster"
  })

  lifecycle {
    ignore_changes = [master_password, global_cluster_identifier]
  }
}

resource "aws_rds_cluster_instance" "main" {
  count = 2

  identifier                   = "${var.environment}-aurora-${count.index + 1}"
  cluster_identifier           = aws_rds_cluster.main.id
  instance_class               = "db.serverless"
  engine                       = "aurora-postgresql"
  engine_version               = var.engine_version
  performance_insights_enabled  = true
  performance_insights_retention_period = 7
  auto_minor_version_upgrade   = true

  tags = merge(var.tags, {
    Name = "${var.environment}-aurora-${count.index + 1}"
  })
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.environment}-db-subnets"
  subnet_ids = var.subnet_ids

  tags = merge(var.tags, {
    Name = "${var.environment}-db-subnets"
  })
}
