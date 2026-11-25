data "aws_secretsmanager_secret" "app" {
  name = "${var.environment}/audioblocks/app"
}

resource "aws_ecs_cluster" "main" {
  name = "audioblocks-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = merge(var.tags, {
    Name = "audioblocks-${var.environment}"
  })
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/audioblocks/${var.environment}/api"
  retention_in_days = 90

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/audioblocks/${var.environment}/worker"
  retention_in_days = 90

  tags = var.tags
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.environment}-audioblocks-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "api"
    image = "${var.ecr_image_uri}:${var.image_tag}"

    portMappings = [{
      containerPort = 4000
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV",  value = var.environment == "production" ? "production" : "staging" },
      { name = "PORT",      value = "4000" }
    ]

    # All secrets injected from Secrets Manager — no plaintext credentials in the task definition
    secrets = [
      { name = "POSTGRES_HOST",     valueFrom = "${data.aws_secretsmanager_secret.app.arn}:POSTGRES_HOST::" },
      { name = "POSTGRES_PORT",     valueFrom = "${data.aws_secretsmanager_secret.app.arn}:POSTGRES_PORT::" },
      { name = "POSTGRES_USER",     valueFrom = "${data.aws_secretsmanager_secret.app.arn}:POSTGRES_USER::" },
      { name = "POSTGRES_PASSWORD", valueFrom = "${data.aws_secretsmanager_secret.app.arn}:POSTGRES_PASSWORD::" },
      { name = "POSTGRES_DATABASE", valueFrom = "${data.aws_secretsmanager_secret.app.arn}:POSTGRES_DATABASE::" },
      { name = "REDIS_HOST",        valueFrom = "${data.aws_secretsmanager_secret.app.arn}:REDIS_HOST::" },
      { name = "REDIS_PORT",        valueFrom = "${data.aws_secretsmanager_secret.app.arn}:REDIS_PORT::" },
      { name = "REDIS_PASSWORD",    valueFrom = "${data.aws_secretsmanager_secret.app.arn}:REDIS_PASSWORD::" },
      { name = "RABBITMQ_URL",      valueFrom = "${data.aws_secretsmanager_secret.app.arn}:RABBITMQ_URL::" },
      { name = "JWT_SECRET",        valueFrom = "${data.aws_secretsmanager_secret.app.arn}:JWT_SECRET::" },
      { name = "AWS_BUCKET_NAME",   valueFrom = "${data.aws_secretsmanager_secret.app.arn}:AWS_BUCKET_NAME::" },
      { name = "AWS_REGION",        valueFrom = "${data.aws_secretsmanager_secret.app.arn}:AWS_REGION::" }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "api"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -sf http://localhost:4000/health/ready || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])

  tags = var.tags
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.environment}-audioblocks-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "worker"
    image = "${var.ecr_image_uri}:${var.image_tag}"
    command = ["node", "dist/workers/songWorkerMain.js"]

    environment = [
      { name = "NODE_ENV", value = var.environment == "production" ? "production" : "staging" }
    ]

    secrets = [
      { name = "POSTGRES_HOST",     valueFrom = "${data.aws_secretsmanager_secret.app.arn}:POSTGRES_HOST::" },
      { name = "POSTGRES_PORT",     valueFrom = "${data.aws_secretsmanager_secret.app.arn}:POSTGRES_PORT::" },
      { name = "POSTGRES_USER",     valueFrom = "${data.aws_secretsmanager_secret.app.arn}:POSTGRES_USER::" },
      { name = "POSTGRES_PASSWORD", valueFrom = "${data.aws_secretsmanager_secret.app.arn}:POSTGRES_PASSWORD::" },
      { name = "POSTGRES_DATABASE", valueFrom = "${data.aws_secretsmanager_secret.app.arn}:POSTGRES_DATABASE::" },
      { name = "REDIS_HOST",        valueFrom = "${data.aws_secretsmanager_secret.app.arn}:REDIS_HOST::" },
      { name = "REDIS_PORT",        valueFrom = "${data.aws_secretsmanager_secret.app.arn}:REDIS_PORT::" },
      { name = "REDIS_PASSWORD",    valueFrom = "${data.aws_secretsmanager_secret.app.arn}:REDIS_PASSWORD::" },
      { name = "RABBITMQ_URL",      valueFrom = "${data.aws_secretsmanager_secret.app.arn}:RABBITMQ_URL::" },
      { name = "AWS_BUCKET_NAME",   valueFrom = "${data.aws_secretsmanager_secret.app.arn}:AWS_BUCKET_NAME::" },
      { name = "AWS_REGION",        valueFrom = "${data.aws_secretsmanager_secret.app.arn}:AWS_REGION::" }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.worker.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "worker"
      }
    }
  }])

  tags = var.tags
}

resource "aws_ecs_service" "api" {
  name                               = "${var.environment}-api"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.api.arn
  desired_count                      = var.api_desired_count
  launch_type                        = "FARGATE"
  health_check_grace_period_seconds  = 60
  force_new_deployment               = true

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_api_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 4000
  }

  tags = var.tags

  lifecycle {
    ignore_changes = [desired_count, task_definition]
  }

  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "worker" {
  name            = "${var.environment}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_worker_security_group_id]
    assign_public_ip = false
  }

  tags = var.tags

  lifecycle {
    ignore_changes = [desired_count, task_definition]
  }
}

resource "aws_lb" "main" {
  name               = "${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = var.environment == "production"

  tags = merge(var.tags, {
    Name = "${var.environment}-alb"
  })
}

resource "aws_lb_target_group" "api" {
  name        = "${var.environment}-api-tg"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health/ready"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 10
    matcher             = "200"
  }

  tags = var.tags
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  tags = var.tags
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }

  tags = var.tags
}

# IAM roles
resource "aws_iam_role" "ecs_execution" {
  name = "${var.environment}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${var.environment}-ecs-secrets-policy"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = data.aws_secretsmanager_secret.app.arn
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${var.environment}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "${var.environment}-ecs-s3-policy"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:DeleteObjects"
      ]
      Resource = [
        "${var.media_bucket_arn}",
        "${var.media_bucket_arn}/*"
      ]
    }]
  })
}
