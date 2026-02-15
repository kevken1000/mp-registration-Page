variable "company_name" {
  description = "Your company name"
  type        = string
}

variable "admin_email" {
  description = "Email for notifications"
  type        = string
}

variable "custom_domain" {
  description = "Custom domain for CloudFront (leave empty for default)"
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for custom domain (must be in us-east-1)"
  type        = string
  default     = ""
}

variable "hosted_zone_id" {
  description = "Route 53 Hosted Zone ID (for automatic cert and DNS setup)"
  type        = string
  default     = ""
}

variable "primary_color" {
  description = "Primary brand color (CSS color name or hex code)"
  type        = string
  default     = "dodgerblue"
}

variable "header_color" {
  description = "Header background color (CSS color name or hex code)"
  type        = string
  default     = "darkslategray"
}

variable "page_title" {
  description = "Page heading (defaults to Welcome to [company_name] AWS Marketplace Registration Page)"
  type        = string
  default     = ""
}

variable "logo_url" {
  description = "Company logo URL"
  type        = string
  default     = ""
}

variable "welcome_message" {
  description = "Welcome message on landing page"
  type        = string
  default     = "Complete your registration to get started"
}

variable "stack_name" {
  description = "Prefix for resource names"
  type        = string
  default     = "mp-landing"
}
