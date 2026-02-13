# -----------------------------------------------------------------------------
# CloudFront Distribution
# -----------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "landing_page" {
  enabled             = true
  default_root_object = "index.html"

  # Custom domain alias (conditional)
  aliases = local.has_custom_domain ? [var.custom_domain] : []

  origin {
    domain_name = aws_s3_bucket.landing_page.bucket_regional_domain_name
    origin_id   = "S3Origin"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.oai.cloudfront_access_identity_path
    }
  }

  default_cache_behavior {
    target_origin_id       = "S3Origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = true
      cookies {
        forward = "none"
      }
    }

    lambda_function_association {
      event_type   = "viewer-request"
      include_body = true
      lambda_arn   = aws_lambda_function.redirect.qualified_arn
    }
  }

  # SSL certificate: custom domain with ACM cert, or default CloudFront cert
  dynamic "viewer_certificate" {
    for_each = local.has_custom_domain ? [1] : []
    content {
      acm_certificate_arn      = local.use_route53 ? aws_acm_certificate.route53[0].arn : var.acm_certificate_arn
      ssl_support_method       = "sni-only"
      minimum_protocol_version = "TLSv1.2_2021"
    }
  }

  dynamic "viewer_certificate" {
    for_each = local.has_custom_domain ? [] : [1]
    content {
      cloudfront_default_certificate = true
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # When using Route 53, wait for cert validation before creating distribution
  depends_on = [aws_acm_certificate_validation.route53]

  lifecycle {
    # CloudFront distributions can take a while to update
    create_before_destroy = false
  }
}
