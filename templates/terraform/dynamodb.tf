# -----------------------------------------------------------------------------
# DynamoDB Tables
# -----------------------------------------------------------------------------
resource "aws_dynamodb_table" "subscribers" {
  name         = "${var.stack_name}-Subscribers"
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "productCode"
  range_key = "customerAWSAccountId"

  attribute {
    name = "productCode"
    type = "S"
  }

  attribute {
    name = "customerAWSAccountId"
    type = "S"
  }

  global_secondary_index {
    name            = "CustomerIndex"
    hash_key        = "customerAWSAccountId"
    range_key       = "productCode"
    projection_type = "ALL"
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"
}

resource "aws_dynamodb_table" "metering" {
  name         = "${var.stack_name}-MeteringRecords"
  billing_mode = "PAY_PER_REQUEST"

  hash_key  = "customerAWSAccountId"
  range_key = "create_timestamp"

  attribute {
    name = "customerAWSAccountId"
    type = "S"
  }

  attribute {
    name = "create_timestamp"
    type = "N"
  }

  attribute {
    name = "metering_pending"
    type = "S"
  }

  attribute {
    name = "productCode"
    type = "S"
  }

  global_secondary_index {
    name            = "PendingMeteringRecordsIndex"
    hash_key        = "metering_pending"
    range_key       = "create_timestamp"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "ProductCodeIndex"
    hash_key        = "productCode"
    range_key       = "create_timestamp"
    projection_type = "ALL"
  }
}
