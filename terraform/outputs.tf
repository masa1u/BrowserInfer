output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.browser_infer.repository_uri
}

output "apprunner_service_url" {
  description = "App Runner service URL"
  value       = aws_apprunner_service.browser_infer.service_url
}

output "apprunner_service_arn" {
  description = "App Runner service ARN"
  value       = aws_apprunner_service.browser_infer.arn
}

output "apprunner_service_id" {
  description = "App Runner service ID"
  value       = aws_apprunner_service.browser_infer.service_id
}

output "ecr_login_command" {
  description = "Command to log in to ECR"
  value       = "aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${aws_ecr_repository.browser_infer.repository_uri}"
}