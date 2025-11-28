terraform {
  required_version = ">= 1.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ECR Repository for Docker images
resource "aws_ecr_repository" "browser_infer" {
  name                 = var.ecr_repository_name
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name        = "BrowserInfer ECR Repository"
    Project     = "BrowserInfer"
    Environment = var.environment
  }
}

# ECR Repository Policy (optional, for cross-account access)
resource "aws_ecr_repository_policy" "browser_infer_policy" {
  repository = aws_ecr_repository.browser_infer.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowPushPull"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
      }
    ]
  })
}

# Data source to get current AWS account ID
data "aws_caller_identity" "current" {}

# IAM Role for App Runner to access ECR
resource "aws_iam_role" "apprunner_access_role" {
  name = "${var.project_name}-apprunner-access-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "build.apprunner.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name    = "BrowserInfer App Runner Access Role"
    Project = "BrowserInfer"
  }
}

# Attach ECR access policy to the role
resource "aws_iam_role_policy_attachment" "apprunner_access_policy" {
  role       = aws_iam_role.apprunner_access_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

# IAM Role for App Runner instance
resource "aws_iam_role" "apprunner_instance_role" {
  name = "${var.project_name}-apprunner-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "tasks.apprunner.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name    = "BrowserInfer App Runner Instance Role"
    Project = "BrowserInfer"
  }
}

# App Runner Service
resource "aws_apprunner_service" "browser_infer" {
  service_name = var.apprunner_service_name

  source_configuration {
    image_repository {
      image_configuration {
        port = "3000"
        runtime_environment_variables = {
          NODE_ENV = var.environment
        }
      }
      image_identifier      = "${aws_ecr_repository.browser_infer.repository_uri}:latest"
      image_repository_type = "ECR"
    }
    auto_deployments_enabled = false
  }

  health_check_configuration {
    healthy_threshold   = 1
    interval            = 10
    path                = "/healthz"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 5
  }

  instance_configuration {
    cpu    = var.cpu
    memory = var.memory
    instance_role_arn = aws_iam_role.apprunner_instance_role.arn
  }

  network_configuration {
    egress_configuration {
      egress_type = "DEFAULT"
    }
  }

  tags = {
    Name        = "BrowserInfer App Runner Service"
    Project     = "BrowserInfer"
    Environment = var.environment
  }

  depends_on = [
    aws_iam_role_policy_attachment.apprunner_access_policy
  ]
}

# App Runner Auto Scaling Configuration (optional)
resource "aws_apprunner_auto_scaling_configuration_version" "browser_infer" {
  auto_scaling_configuration_name = "${var.project_name}-auto-scaling"

  max_concurrency = var.max_concurrency
  max_size         = var.max_size
  min_size         = var.min_size

  tags = {
    Name    = "BrowserInfer Auto Scaling Configuration"
    Project = "BrowserInfer"
  }
}