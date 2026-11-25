resource "aws_mq_broker" "main" {
  broker_name        = "${var.environment}-rabbitmq"
  engine_type        = "RabbitMQ"
  engine_version     = var.engine_version
  host_instance_type = var.instance_type
  deployment_mode    = "CLUSTER_MULTI_AZ"
  publicly_accessible = false
  subnet_ids          = var.subnet_ids
  security_groups     = [var.security_group_id]

  user {
    username = var.mq_username
    password = var.mq_password
  }

  encryption_options {
    use_aws_owned_key = true
  }

  logs {
    general = true
  }

  maintenance_window_start_time {
    day_of_week = "SUNDAY"
    time_of_day = "04:00"
    time_zone   = "UTC"
  }

  tags = merge(var.tags, {
    Name = "${var.environment}-rabbitmq"
  })
}
