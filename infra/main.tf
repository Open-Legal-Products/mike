# Atlas Mike — Staging Infrastructure
# Region: us-east-1
# Environment: staging
# Managed by: Mimosa Malpassada
#
# Uses the default VPC (vpc-0c0ae5e34f87f4399) with existing subnets.
# Uses the native ALB hostname (HTTP only, no custom domain or certificate).

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Backend will be migrated to S3 after initial bootstrap.
  # Run `terraform init` with local backend for first apply.
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project          = "atlas-mike"
      Environment      = "staging"
      Owner            = "mimosa-malpassada"
      CostCenter       = "atlas-governance"
      ManagedBy        = "terraform"
      DataClassification = "synthetic-only"
    }
  }
}

# =============================================================================
# Data sources — reuse existing resources
# =============================================================================

data "aws_vpc" "default" {
  id = "vpc-0c0ae5e34f87f4399"
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_caller_identity" "current" {}

# No ACM certificate or Route53 zone needed — using native ALB hostname over HTTP.

# GitHub OIDC provider (already exists)
data "aws_iam_openid_connect_provider" "github" {
  arn = "arn:aws:iam::136770599935:oidc-provider/token.actions.githubusercontent.com"
}

# =============================================================================
# S3 — Terraform state bucket and DynamoDB lock table
# =============================================================================

resource "aws_s3_bucket" "tfstate" {
  bucket = "atlas-mike-staging-tfstate"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "tf_locks" {
  name         = "atlas-mike-staging-tf-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

# =============================================================================
# S3 — Document storage
# =============================================================================

resource "aws_s3_bucket" "documents" {
  bucket = "atlas-mike-staging-documents"
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# =============================================================================
# ECR — Container registries
# =============================================================================

resource "aws_ecr_repository" "frontend" {
  name                 = "atlas-mike-staging/frontend"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "backend" {
  name                 = "atlas-mike-staging/backend"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

# =============================================================================
# Security Groups
# =============================================================================

resource "aws_security_group" "alb" {
  name        = "atlas-mike-staging-alb-sg"
  description = "Allow HTTP/HTTPS from internet"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    protocol    = "tcp"
    from_port   = 80
    to_port     = 80
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "frontend" {
  name        = "atlas-mike-staging-frontend-sg"
  description = "Allow traffic from ALB to frontend"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    protocol        = "tcp"
    from_port       = 3000
    to_port         = 3000
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "backend" {
  name        = "atlas-mike-staging-backend-sg"
  description = "Allow traffic from ALB and frontend to backend"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    protocol        = "tcp"
    from_port       = 3001
    to_port         = 3001
    security_groups = [aws_security_group.alb.id, aws_security_group.frontend.id]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# =============================================================================
# ALB — Application Load Balancer
# =============================================================================

resource "aws_lb" "mike" {
  name               = "atlas-mike-staging-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids

  enable_deletion_protection = false

  tags = {
    Name = "atlas-mike-staging-alb"
  }
}

# Target group for frontend (port 3000)
resource "aws_lb_target_group" "frontend" {
  name        = "atlas-mike-stg-frontend-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200-399"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Target group for backend (port 3001)
resource "aws_lb_target_group" "backend" {
  name        = "atlas-mike-stg-backend-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# HTTP listener (port 80) — forward to frontend (native ALB hostname, no HTTPS)
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.mike.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

# Listener rule for Supabase paths (Kong API gateway)
resource "aws_lb_listener_rule" "supabase" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 50

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.supabase.arn
  }

  condition {
    path_pattern {
      values = ["/supabase/*"]
    }
  }
}

# Target group for supabase (Kong on port 8000)
resource "aws_lb_target_group" "supabase" {
  name        = "atlas-mike-stg-sup-tg"
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200-499"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Security group for supabase (Kong)
resource "aws_security_group" "supabase" {
  name        = "atlas-mike-staging-supabase-sg"
  description = "Allow traffic from ALB to supabase (Kong)"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    protocol        = "tcp"
    from_port       = 8000
    to_port         = 8000
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# No Route53 record — using native ALB hostname directly.

# =============================================================================
# CloudWatch — Log groups
# =============================================================================

resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/ecs/atlas-mike-staging-frontend"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/atlas-mike-staging-backend"
  retention_in_days = 14
}

# =============================================================================
# IAM — Task execution role
# =============================================================================

resource "aws_iam_role" "task_execution" {
  name = "atlas-mike-staging-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow task execution to read secrets from Secrets Manager
resource "aws_iam_role_policy" "task_execution_secrets" {
  name = "atlas-mike-staging-secrets-read"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue"
      ]
      Resource = aws_secretsmanager_secret.app.arn
    }]
  })
}

# =============================================================================
# IAM — Task role (runtime permissions)
# =============================================================================

resource "aws_iam_role" "task" {
  name = "atlas-mike-staging-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

# Allow task to access S3 documents bucket
resource "aws_iam_role_policy" "task_s3" {
  name = "atlas-mike-staging-s3-access"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:HeadObject",
        "s3:ListBucket",
        "s3:AbortMultipartUpload"
      ]
      Resource = [
        aws_s3_bucket.documents.arn,
        "${aws_s3_bucket.documents.arn}/*"
      ]
    }]
  })
}

# =============================================================================
# Secrets Manager — Application secrets
# =============================================================================

resource "aws_secretsmanager_secret" "app" {
  name        = "atlas-mike-staging-app-secrets"
  description = "Application secrets for Mike staging environment"

  recovery_window_in_days = 7
}

# =============================================================================
# ECS Cluster
# =============================================================================

resource "aws_ecs_cluster" "mike" {
  name = "atlas-mike-staging-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# =============================================================================
# GitHub OIDC — Deploy role for CI/CD
# =============================================================================

resource "aws_iam_role" "github_deploy" {
  name = "atlas-mike-staging-github-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = data.aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:Edu-Carone-SA/mike:*"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "atlas-mike-staging-deploy-permissions"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:RegisterTaskDefinition",
          "ecs:ListTaskDefinitions"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:UpdateService",
          "ecs:CreateService",
          "ecs:RunTask"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "iam:PassRole"
        ]
        Resource = [
          aws_iam_role.task_execution.arn,
          aws_iam_role.task.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecret"
        ]
        Resource = aws_secretsmanager_secret.app.arn
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      }
    ]
  })
}

# =============================================================================
# CloudWatch Alarms
# =============================================================================

resource "aws_cloudwatch_metric_alarm" "backend_5xx" {
  alarm_name          = "atlas-mike-stg-backend-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Backend 5xx errors above threshold"
}

resource "aws_cloudwatch_metric_alarm" "backend_unhealthy" {
  alarm_name          = "atlas-mike-stg-backend-unhealthy"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = 0
  alarm_description   = "Backend unhealthy hosts"
}

# =============================================================================
# Budget
# =============================================================================

resource "aws_budgets_budget" "staging" {
  name         = "atlas-mike-staging-monthly"
  budget_type  = "COST"
  limit_amount = "50"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator = "GREATER_THAN"
    threshold           = 80
    threshold_type      = "PERCENTAGE"
    notification_type   = "EMAIL"
  }
}

# =============================================================================
# Outputs
# =============================================================================

output "alb_dns_name" {
  value = aws_lb.mike.dns_name
}

output "frontend_url" {
  value = "http://${aws_lb.mike.dns_name}"
}

output "ecr_frontend_uri" {
  value = aws_ecr_repository.frontend.repository_uri
}

output "ecr_backend_uri" {
  value = aws_ecr_repository.backend.repository_uri
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.mike.name
}

output "frontend_tg_arn" {
  value = aws_lb_target_group.frontend.arn
}

output "backend_tg_arn" {
  value = aws_lb_target_group.backend.arn
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "secrets_arn" {
  value = aws_secretsmanager_secret.app.arn
}

output "documents_bucket" {
  value = aws_s3_bucket.documents.id
}

output "task_execution_role_arn" {
  value = aws_iam_role.task_execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}
