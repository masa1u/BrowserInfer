variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "browser-infer"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "ecr_repository_name" {
  description = "ECR repository name"
  type        = string
  default     = "browser-infer"
}

variable "apprunner_service_name" {
  description = "App Runner service name"
  type        = string
  default     = "browser-infer-service"
}

variable "cpu" {
  description = "CPU units for App Runner service (0.25 vCPU, 0.5 vCPU, 1 vCPU, or 2 vCPU)"
  type        = string
  default     = "0.25 vCPU"
  
  validation {
    condition = contains([
      "0.25 vCPU", "0.5 vCPU", "1 vCPU", "2 vCPU"
    ], var.cpu)
    error_message = "CPU must be one of: 0.25 vCPU, 0.5 vCPU, 1 vCPU, 2 vCPU."
  }
}

variable "memory" {
  description = "Memory for App Runner service (0.5 GB, 1 GB, 2 GB, 3 GB, 4 GB, 6 GB, 8 GB, 10 GB, or 12 GB)"
  type        = string
  default     = "0.5 GB"
  
  validation {
    condition = contains([
      "0.5 GB", "1 GB", "2 GB", "3 GB", "4 GB", "6 GB", "8 GB", "10 GB", "12 GB"
    ], var.memory)
    error_message = "Memory must be one of the valid App Runner memory configurations."
  }
}

variable "max_concurrency" {
  description = "Maximum number of concurrent requests per instance"
  type        = number
  default     = 15
  
  validation {
    condition     = var.max_concurrency >= 1 && var.max_concurrency <= 1000
    error_message = "Max concurrency must be between 1 and 1000."
  }
}

variable "max_size" {
  description = "Maximum number of instances for auto scaling"
  type        = number
  default     = 2
  
  validation {
    condition     = var.max_size >= 1 && var.max_size <= 1000
    error_message = "Max size must be between 1 and 1000."
  }
}

variable "min_size" {
  description = "Minimum number of instances for auto scaling"
  type        = number
  default     = 1
  
  validation {
    condition     = var.min_size >= 1 && var.min_size <= 25
    error_message = "Min size must be between 1 and 25."
  }
}