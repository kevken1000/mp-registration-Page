# -----------------------------------------------------------------------------
# Metering Pipeline (SQS + EventBridge Schedule)
# -----------------------------------------------------------------------------
resource "aws_sqs_queue" "metering" {
  name                       = "${var.stack_name}-MeteringQueue"
  visibility_timeout_seconds = 120
}

resource "aws_lambda_event_source_mapping" "metering_processor" {
  event_source_arn = aws_sqs_queue.metering.arn
  function_name    = aws_lambda_function.metering_processor.arn
  batch_size       = 10
}

resource "aws_cloudwatch_event_rule" "metering_schedule" {
  name                = "${var.stack_name}-MeteringSchedule"
  description         = "Trigger metering job every hour"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "metering_job" {
  rule = aws_cloudwatch_event_rule.metering_schedule.name
  arn  = aws_lambda_function.metering_job.arn
}

resource "aws_lambda_permission" "metering_schedule" {
  function_name = aws_lambda_function.metering_job.function_name
  action        = "lambda:InvokeFunction"
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.metering_schedule.arn
}

resource "aws_cloudwatch_metric_alarm" "metering_processor_errors" {
  alarm_name          = "${var.stack_name}-MeteringProcessorErrors"
  alarm_description   = "Metering processor Lambda is failing to submit usage to AWS Marketplace"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions = {
    FunctionName = aws_lambda_function.metering_processor.function_name
  }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.notifications.arn]
}

# -----------------------------------------------------------------------------
# Subscription Lifecycle Events (EventBridge)
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "subscription_events" {
  name        = "${var.stack_name}-SubscriptionEvents"
  description = "Capture AWS Marketplace agreement and license events"

  event_pattern = jsonencode({
    source      = ["aws.agreement-marketplace"]
    detail-type = [
      "Purchase Agreement Created - Proposer",
      "Purchase Agreement Created - Manufacturer",
      "Purchase Agreement Amended - Proposer",
      "Purchase Agreement Amended - Manufacturer",
      "Purchase Agreement Ended - Proposer",
      "Purchase Agreement Ended - Manufacturer",
      "License Updated - Manufacturer",
      "License Deprovisioned - Manufacturer",
    ]
  })
}

resource "aws_cloudwatch_event_target" "subscription_event" {
  rule = aws_cloudwatch_event_rule.subscription_events.name
  arn  = aws_lambda_function.subscription_event.arn
}

resource "aws_lambda_permission" "subscription_events" {
  function_name = aws_lambda_function.subscription_event.function_name
  action        = "lambda:InvokeFunction"
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.subscription_events.arn
}
