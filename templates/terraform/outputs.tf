output "landing_page_bucket" {
  description = "S3 bucket for landing page files"
  value       = aws_s3_bucket.landing_page.id
}

output "cloudfront_url" {
  description = "CloudFront URL for your landing page"
  value       = aws_cloudfront_distribution.landing_page.domain_name
}

output "custom_domain_url" {
  description = "Custom domain URL (if configured)"
  value       = local.has_custom_domain ? "https://${var.custom_domain}" : "N/A"
}

output "api_endpoint" {
  description = "API Gateway endpoint for registration"
  value       = "${aws_apigatewayv2_api.api.api_endpoint}/register"
}

output "subscribers_table" {
  description = "DynamoDB table for subscribers"
  value       = aws_dynamodb_table.subscribers.name
}

output "metering_table" {
  description = "DynamoDB table for metering records"
  value       = aws_dynamodb_table.metering.name
}

output "metering_queue" {
  description = "SQS queue for metering processing"
  value       = aws_sqs_queue.metering.url
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (for cache invalidation)"
  value       = aws_cloudfront_distribution.landing_page.id
}
