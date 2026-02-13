# AWS Marketplace Metering Guide

This solution includes complete metering functionality for AWS Marketplace SaaS products.

## When Do You Need Metering?

Metering is **required** for:
- **SaaS Subscription** listings (usage-based pricing)
- **SaaS Contract with Subscription** listings (hybrid pricing)

Metering is **NOT needed** for:
- **SaaS Contract** listings (upfront pricing only)

The CloudFormation template automatically creates metering resources only when needed based on your listing type selection.

## How Metering Works

The metering system automatically:
1. Collects usage records from your application
2. Aggregates them hourly by customer and dimension
3. Sends them to AWS Marketplace BatchMeterUsage API
4. Tracks success/failure for each submission

## Architecture

```
Your App → DynamoDB (Metering Records)
              ↓
    CloudWatch Event (Hourly)
              ↓
    Lambda (Metering Job) → Aggregates Records
              ↓
         SQS Queue
              ↓
    Lambda (Processor) → AWS Marketplace API
              ↓
    Updates DynamoDB (Status)
```

## Recording Usage

Your application should write usage records to the `<StackName>-MeteringRecords` DynamoDB table:

### Record Format

```json
{
  "customerAWSAccountId": "123456789012",
  "productCode": "abc123xyz456",
  "create_timestamp": 1708012345678,
  "dimension": "users",
  "quantity": 5,
  "metering_pending": "true"
}
```

### Required Fields

- `customerAWSAccountId` (String): Customer's AWS Account ID from registration (per AWS docs, use this instead of CustomerIdentifier for new implementations)
- `productCode` (String): AWS Marketplace product code
- `create_timestamp` (Number): Unix timestamp in milliseconds
- `dimension` (String): Your pricing dimension (e.g., "users", "api_calls", "storage_gb") — case-sensitive
- `quantity` (Number): Usage amount
- `metering_pending` (String): Must be "true" for new records

**Important**: Always include the `productCode` field. This allows the system to handle multiple products from the same seller.

### Example: Recording Usage from Your App

**Node.js:**
```javascript
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());

async function recordUsage(customerAWSAccountId, productCode, dimension, quantity) {
    await dynamodb.send(new PutCommand({
        TableName: 'YOUR_STACK_NAME-MeteringRecords',
        Item: {
            customerAWSAccountId,
            productCode,
            create_timestamp: Date.now(),
            dimension,
            quantity,
            metering_pending: 'true'
        }
    }));
}

// Example: Record 10 API calls for a customer on Product A
await recordUsage('123456789012', 'abc123xyz456', 'api_calls', 10);

// Example: Record 5 users for the same customer on Product B
await recordUsage('123456789012', 'def789uvw012', 'users', 5);
```

**Python:**
```python
import boto3
import time

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('YOUR_STACK_NAME-MeteringRecords')

def record_usage(customer_aws_account_id, product_code, dimension, quantity):
    table.put_item(
        Item={
            'customerAWSAccountId': customer_aws_account_id,
            'productCode': product_code,
            'create_timestamp': int(time.time() * 1000),
            'dimension': dimension,
            'quantity': quantity,
            'metering_pending': 'true'
        }
    )

# Example: Record 5 users for a customer on Product A
record_usage('123456789012', 'abc123xyz456', 'users', 5)

# Example: Record storage for the same customer on Product B
record_usage('123456789012', 'def789uvw012', 'storage_gb', 100)
```

## Metering Dimensions

Define your dimensions when creating your AWS Marketplace product. Common examples:

- **users**: Number of active users
- **api_calls**: Number of API requests
- **storage_gb**: Gigabytes of storage used
- **compute_hours**: Hours of compute time
- **transactions**: Number of transactions processed

## Multi-Product Support

This solution supports sellers with multiple AWS Marketplace products:

### How It Works

1. Each metering record includes a `productCode` field
2. The hourly job aggregates records by product code, customer, and dimension
3. Each product's usage is sent to AWS Marketplace with the correct product code
4. You can query metering records by product using the `ProductCodeIndex`

### Deployment Options

**Option 1: Single Stack for All Products (Recommended)**
- Deploy one CloudFormation stack
- Use shared DynamoDB tables for all products
- Each product has its own landing page (deploy stack multiple times with different product codes)
- Metering system handles all products automatically

**Option 2: Separate Stack Per Product**
- Deploy a separate stack for each product
- Each product has isolated resources
- More complex to manage but provides complete isolation

### Querying by Product

```bash
# Get all metering records for a specific product
aws dynamodb query \
  --table-name YOUR_STACK_NAME-MeteringRecords \
  --index-name ProductCodeIndex \
  --key-condition-expression "productCode = :code" \
  --expression-attribute-values '{":code":{"S":"abc123xyz456"}}'
```

### Best Practices for Multiple Products

1. **Use consistent dimension names** across products when possible
2. **Tag records** with product-specific metadata if needed
3. **Monitor per-product** metering success rates
4. **Test each product** independently before going live
5. **Document product codes** in your application configuration

## Monitoring Metering

### Check Pending Records

```bash
aws dynamodb query \
  --table-name YOUR_STACK_NAME-MeteringRecords \
  --index-name PendingMeteringRecordsIndex \
  --key-condition-expression "metering_pending = :pending" \
  --expression-attribute-values '{":pending":{"S":"true"}}'
```

### Check Failed Records

```bash
aws dynamodb scan \
  --table-name YOUR_STACK_NAME-MeteringRecords \
  --filter-expression "metering_failed = :failed" \
  --expression-attribute-values '{":failed":{"BOOL":true}}'
```

### View Metering Logs

```bash
# Metering Job logs
aws logs tail /aws/lambda/YOUR_STACK_NAME-MeteringJob --follow

# Metering Processor logs
aws logs tail /aws/lambda/YOUR_STACK_NAME-MeteringProcessor --follow
```

## Metering Schedule

- Runs every hour via CloudWatch Events
- Aggregates all pending records
- Sends batched requests to AWS Marketplace
- Updates records with success/failure status

## Troubleshooting

### Records Not Being Processed

1. Check CloudWatch Events rule is enabled:
```bash
aws events describe-rule --name YOUR_STACK_NAME-MeteringSchedule
```

2. Check Lambda function logs for errors

3. Verify IAM permissions for marketplace:BatchMeterUsage

### Failed Metering Records

Failed records remain in the table with `metering_failed: true`. To retry:

1. Update the record to set `metering_pending: "true"` and `metering_failed: false`
2. Wait for the next hourly job to process it

### Testing Metering

You can manually trigger the metering job:

```bash
aws lambda invoke \
  --function-name YOUR_STACK_NAME-MeteringJob \
  --payload '{}' \
  response.json
```

## Best Practices

1. **Record frequently**: Write usage records as events occur, not in batches
2. **Use appropriate dimensions**: Match your AWS Marketplace product configuration
3. **Monitor failures**: Set up CloudWatch alarms for failed metering records
4. **Aggregate in your app**: If you have high-frequency events, aggregate before writing to DynamoDB
5. **Handle duplicates**: The system aggregates by customer and dimension per hour

## Cost Optimization

- DynamoDB uses on-demand billing
- Lambda executions are minimal (hourly + queue processing)
- SQS has no charges for the first 1M requests/month
- Consider archiving old metering records after AWS Marketplace confirms receipt

## Integration with Your SaaS Application

Grant your application IAM permissions to write to the metering table:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT:table/YOUR_STACK_NAME-MeteringRecords"
    }
  ]
}
```

Then integrate metering into your application logic wherever usage occurs.
