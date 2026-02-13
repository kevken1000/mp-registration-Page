# -----------------------------------------------------------------------------
# IAM Roles
# -----------------------------------------------------------------------------
data "aws_caller_identity" "current" {}

# Lambda execution role (registration, metering, subscription events)
resource "aws_iam_role" "lambda_execution" {
  name_prefix = "${var.stack_name}-lambda-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_marketplace" {
  name = "MarketplaceAccess"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["aws-marketplace:ResolveCustomer", "aws-marketplace:BatchMeterUsage"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:Scan"]
        Resource = [
          aws_dynamodb_table.subscribers.arn,
          "${aws_dynamodb_table.subscribers.arn}/index/*",
          aws_dynamodb_table.metering.arn,
          "${aws_dynamodb_table.metering.arn}/index/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.metering.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = aws_sns_topic.notifications.arn
      },
    ]
  })
}

# Lambda@Edge role (separate trust for edgelambda.amazonaws.com)
resource "aws_iam_role" "edge_lambda" {
  name_prefix = "${var.stack_name}-edge-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = ["lambda.amazonaws.com", "edgelambda.amazonaws.com"] }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "edge_lambda_basic" {
  role       = aws_iam_role.edge_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Deploy landing page role (custom resource equivalent)
resource "aws_iam_role" "deploy_landing_page" {
  name_prefix = "${var.stack_name}-deploy-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "deploy_basic" {
  role       = aws_iam_role.deploy_landing_page.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "deploy_s3" {
  name = "S3Deploy"
  role = aws_iam_role.deploy_landing_page.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:DeleteObject"]
      Resource = "${aws_s3_bucket.landing_page.arn}/*"
    }]
  })
}
