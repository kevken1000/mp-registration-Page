# -----------------------------------------------------------------------------
# SNS Notifications
# -----------------------------------------------------------------------------
resource "aws_sns_topic" "notifications" {
  name         = "${var.stack_name}-Notifications"
  display_name = "${var.company_name} Marketplace Notifications"
}

resource "aws_sns_topic_subscription" "admin_email" {
  topic_arn = aws_sns_topic.notifications.arn
  protocol  = "email"
  endpoint  = var.admin_email
}
