terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.0"
    }
  }
}

# Lambda@Edge and ACM for CloudFront require us-east-1
provider "aws" {
  region = "us-east-1"
}

locals {
  has_custom_domain = var.custom_domain != ""
  use_route53       = local.has_custom_domain && var.hosted_zone_id != ""
  use_external_dns  = local.has_custom_domain && var.hosted_zone_id == ""
}

# -----------------------------------------------------------------------------
# S3 Bucket for Landing Page
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "landing_page" {
  bucket_prefix = "${var.stack_name}-landing-"
  force_destroy = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "landing_page" {
  bucket = aws_s3_bucket.landing_page.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "landing_page" {
  bucket                  = aws_s3_bucket.landing_page.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_identity" "oai" {
  comment = "OAI for ${var.stack_name}"
}

resource "aws_s3_bucket_policy" "landing_page" {
  bucket = aws_s3_bucket.landing_page.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontAccess"
      Effect    = "Allow"
      Principal = { CanonicalUser = aws_cloudfront_origin_access_identity.oai.s3_canonical_user_id }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.landing_page.arn}/*"
    }]
  })
}
