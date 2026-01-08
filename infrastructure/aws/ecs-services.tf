# ECS Task Definitions and Services for BlaidTrades

# =============================================================================
# Secrets Manager for Application Secrets
# =============================================================================

resource "aws_secretsmanager_secret" "app_secrets" {
  name                    = "${var.app_name}/${var.environment}/app-secrets"
  description             = "Application secrets for BlaidTrades"
  recovery_window_in_days = var.environment == "production" ? 30 : 0
}

# Initial empty secret - populate via AWS Console or CI/CD
resource "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    OPENAI_API_KEY        = "REPLACE_ME"
    ANTHROPIC_API_KEY     = "REPLACE_ME"
    GROQ_API_KEY          = "REPLACE_ME"
    XAI_API_KEY           = "REPLACE_ME"
    GOOGLE_GEMINI_API_KEY = "REPLACE_ME"
    PERPLEXITY_API_KEY    = "REPLACE_ME"
    DATABENTO_API_KEY     = "REPLACE_ME"
    POLYGON_API_KEY       = "REPLACE_ME"
    FINNHUB_API_KEY       = "REPLACE_ME"
    FMP_API_KEY           = "REPLACE_ME"
    FRED_API_KEY          = "REPLACE_ME"
    NEWS_API_KEY          = "REPLACE_ME"
    MARKETAUX_API_KEY     = "REPLACE_ME"
    UNUSUAL_WHALES_API_KEY = "REPLACE_ME"
    GOOGLE_CLIENT_ID      = "REPLACE_ME"
    GOOGLE_CLIENT_SECRET  = "REPLACE_ME"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# =============================================================================
# Redis Auth Token (required for ElastiCache with transit encryption)
# =============================================================================

resource "random_password" "redis_auth" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "redis_auth" {
  name                    = "${var.app_name}/${var.environment}/redis-auth"
  description             = "Redis auth token for ElastiCache"
  recovery_window_in_days = var.environment == "production" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id     = aws_secretsmanager_secret.redis_auth.id
  secret_string = random_password.redis_auth.result
}

# =============================================================================
# API Task Definition
# =============================================================================

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.app_name}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "api"
      image = "${aws_ecr_repository.app.repository_url}:latest"

      portMappings = [
        {
          containerPort = 5000
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "5000" },
        { name = "WORKER_MODE", value = "false" },
        { name = "DB_HOST", value = aws_rds_cluster.aurora.endpoint },
        { name = "DB_READER_HOST", value = aws_rds_cluster.aurora.reader_endpoint },
        { name = "DB_PORT", value = "5432" },
        { name = "DB_NAME", value = "blaidtrades" },
        { name = "DB_USER", value = aws_rds_cluster.aurora.master_username },
        { name = "REDIS_HOST", value = aws_elasticache_replication_group.redis.primary_endpoint_address },
        { name = "REDIS_PORT", value = "6379" },
        { name = "REDIS_TLS", value = "true" },
        { name = "PRODUCTION_URL", value = var.domain_name != "" ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}" }
      ]

      secrets = [
        { name = "DB_PASSWORD", valueFrom = "${aws_rds_cluster.aurora.master_user_secret[0].secret_arn}:password::" },
        { name = "REDIS_PASSWORD", valueFrom = aws_secretsmanager_secret.redis_auth.arn },
        { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:OPENAI_API_KEY::" },
        { name = "ANTHROPIC_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:ANTHROPIC_API_KEY::" },
        { name = "GROQ_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:GROQ_API_KEY::" },
        { name = "DATABENTO_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:DATABENTO_API_KEY::" },
        { name = "POLYGON_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:POLYGON_API_KEY::" },
        { name = "GOOGLE_CLIENT_ID", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:GOOGLE_CLIENT_ID::" },
        { name = "GOOGLE_CLIENT_SECRET", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:GOOGLE_CLIENT_SECRET::" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:5000/api/health || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 60
      }
    }
  ])
}

# =============================================================================
# Worker Task Definition
# =============================================================================

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.app_name}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "worker"
      image = "${aws_ecr_repository.app.repository_url}:worker-latest"

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "WORKER_MODE", value = "true" },
        { name = "MAX_HEAVY_BACKTEST_CONCURRENCY", value = "4" },
        { name = "MAX_LIGHT_BACKTEST_CONCURRENCY", value = "8" },
        { name = "DB_HOST", value = aws_rds_cluster.aurora.endpoint },
        { name = "DB_READER_HOST", value = aws_rds_cluster.aurora.reader_endpoint },
        { name = "DB_PORT", value = "5432" },
        { name = "DB_NAME", value = "blaidtrades" },
        { name = "DB_USER", value = aws_rds_cluster.aurora.master_username },
        { name = "REDIS_HOST", value = aws_elasticache_replication_group.redis.primary_endpoint_address },
        { name = "REDIS_PORT", value = "6379" },
        { name = "REDIS_TLS", value = "true" }
      ]

      secrets = [
        { name = "DB_PASSWORD", valueFrom = "${aws_rds_cluster.aurora.master_user_secret[0].secret_arn}:password::" },
        { name = "REDIS_PASSWORD", valueFrom = aws_secretsmanager_secret.redis_auth.arn },
        { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:OPENAI_API_KEY::" },
        { name = "ANTHROPIC_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:ANTHROPIC_API_KEY::" },
        { name = "GROQ_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:GROQ_API_KEY::" },
        { name = "DATABENTO_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:DATABENTO_API_KEY::" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])
}

# =============================================================================
# API Service
# =============================================================================

resource "aws_ecs_service" "api" {
  name            = "${var.app_name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 5000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_configuration {
    maximum_percent         = 200
    minimum_healthy_percent = 100
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}

# =============================================================================
# Worker Service
# =============================================================================

resource "aws_ecs_service" "worker" {
  name            = "${var.app_name}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}

# =============================================================================
# Auto Scaling for API
# =============================================================================

resource "aws_appautoscaling_target" "api" {
  max_capacity       = 10
  min_capacity       = var.api_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${var.app_name}-api-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "api_memory" {
  name               = "${var.app_name}-api-memory-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 80.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# =============================================================================
# Auto Scaling for Workers
# =============================================================================

resource "aws_appautoscaling_target" "worker" {
  max_capacity       = 10
  min_capacity       = var.worker_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "worker_cpu" {
  name               = "${var.app_name}-worker-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
