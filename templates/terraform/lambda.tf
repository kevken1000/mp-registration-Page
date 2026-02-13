# -----------------------------------------------------------------------------
# Lambda Functions
# -----------------------------------------------------------------------------

# Archive data sources for Lambda zip packages
data "archive_file" "redirect" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/redirect"
  output_path = "${path.module}/.build/redirect.zip"
}

data "archive_file" "register" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/register"
  output_path = "${path.module}/.build/register.zip"
}

data "archive_file" "metering_job" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/metering-job"
  output_path = "${path.module}/.build/metering-job.zip"
}

data "archive_file" "metering_processor" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/metering-processor"
  output_path = "${path.module}/.build/metering-processor.zip"
}

data "archive_file" "subscription_event" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/subscription-event"
  output_path = "${path.module}/.build/subscription-event.zip"
}

data "archive_file" "deploy_landing_page" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/deploy-landing-page"
  output_path = "${path.module}/.build/deploy-landing-page.zip"
}

# Lambda@Edge: POST-to-GET redirect
resource "aws_lambda_function" "redirect" {
  function_name    = "${var.stack_name}-Redirect"
  runtime          = "nodejs18.x"
  handler          = "index.handler"
  role             = aws_iam_role.edge_lambda.arn
  filename         = data.archive_file.redirect.output_path
  source_code_hash = data.archive_file.redirect.output_base64sha256
  publish          = true # Required for Lambda@Edge (needs a version)
}

# Registration Lambda
resource "aws_lambda_function" "register" {
  function_name    = "${var.stack_name}-RegisterSubscriber"
  runtime          = "nodejs18.x"
  handler          = "index.handler"
  role             = aws_iam_role.lambda_execution.arn
  filename         = data.archive_file.register.output_path
  source_code_hash = data.archive_file.register.output_base64sha256

  environment {
    variables = {
      SUBSCRIBERS_TABLE = aws_dynamodb_table.subscribers.name
      SNS_TOPIC_ARN     = aws_sns_topic.notifications.arn
    }
  }
}

# Metering job Lambda (hourly aggregation)
resource "aws_lambda_function" "metering_job" {
  function_name    = "${var.stack_name}-MeteringJob"
  runtime          = "nodejs18.x"
  handler          = "index.handler"
  role             = aws_iam_role.lambda_execution.arn
  timeout          = 300
  filename         = data.archive_file.metering_job.output_path
  source_code_hash = data.archive_file.metering_job.output_base64sha256

  environment {
    variables = {
      METERING_TABLE     = aws_dynamodb_table.metering.name
      METERING_QUEUE_URL = aws_sqs_queue.metering.url
    }
  }
}

# Metering processor Lambda (SQS consumer, calls BatchMeterUsage)
resource "aws_lambda_function" "metering_processor" {
  function_name    = "${var.stack_name}-MeteringProcessor"
  runtime          = "nodejs18.x"
  handler          = "index.handler"
  role             = aws_iam_role.lambda_execution.arn
  timeout          = 60
  filename         = data.archive_file.metering_processor.output_path
  source_code_hash = data.archive_file.metering_processor.output_base64sha256

  environment {
    variables = {
      METERING_TABLE    = aws_dynamodb_table.metering.name
      SUBSCRIBERS_TABLE = aws_dynamodb_table.subscribers.name
    }
  }
}

# Subscription lifecycle event handler
resource "aws_lambda_function" "subscription_event" {
  function_name    = "${var.stack_name}-SubscriptionEvent"
  runtime          = "nodejs18.x"
  handler          = "index.handler"
  role             = aws_iam_role.lambda_execution.arn
  timeout          = 30
  filename         = data.archive_file.subscription_event.output_path
  source_code_hash = data.archive_file.subscription_event.output_base64sha256

  environment {
    variables = {
      SUBSCRIBERS_TABLE = aws_dynamodb_table.subscribers.name
      SNS_TOPIC_ARN     = aws_sns_topic.notifications.arn
    }
  }
}

# Deploy landing page Lambda (replaces CloudFormation custom resource)
resource "aws_lambda_function" "deploy_landing_page" {
  function_name    = "${var.stack_name}-DeployLandingPage"
  runtime          = "nodejs18.x"
  handler          = "index.handler"
  role             = aws_iam_role.deploy_landing_page.arn
  timeout          = 60
  filename         = data.archive_file.deploy_landing_page.output_path
  source_code_hash = data.archive_file.deploy_landing_page.output_base64sha256

  environment {
    variables = {
      BUCKET  = aws_s3_bucket.landing_page.id
      API_URL = "${aws_apigatewayv2_api.api.api_endpoint}/register"
      COMPANY = var.company_name
      COLOR1  = var.primary_color
      COLOR2  = var.header_color
      LOGO    = var.logo_url
      WELCOME = var.welcome_message
    }
  }
}

# Invoke the deploy Lambda after creation/update (replaces CF custom resource)
resource "aws_lambda_invocation" "deploy_landing_page" {
  function_name = aws_lambda_function.deploy_landing_page.function_name

  input = jsonencode({
    action  = "deploy"
    version = "5"
  })

  triggers = {
    # Re-invoke when branding or API URL changes
    company = var.company_name
    color1  = var.primary_color
    color2  = var.header_color
    logo    = var.logo_url
    welcome = var.welcome_message
    api_url = aws_apigatewayv2_api.api.api_endpoint
  }

  depends_on = [
    aws_s3_bucket_policy.landing_page,
    aws_apigatewayv2_stage.default,
  ]
}
