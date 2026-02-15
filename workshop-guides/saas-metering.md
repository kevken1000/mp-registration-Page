# Lab: SaaS Metering Integration with AWS Marketplace

In this lab, you will set up usage metering for your SaaS product listed on AWS Marketplace. You will learn how to write usage records from your application and submit them to the `BatchMeterUsage` API. If you deployed the sample solution, the metering pipeline is already running and you only need to write records to the DynamoDB table.

## When metering applies

| Pricing model | Metering required? |
|---------------|-------------------|
| SaaS Subscriptions | Yes, all usage is metered |
| SaaS Contracts with Consumption | Yes, for usage beyond contract entitlements |
| SaaS Contracts (fixed) | No |

## How metering works

The following diagram shows the metering pipeline flow:

```
Your SaaS Application
        ↓ (writes usage records)
DynamoDB (MeteringRecords table)
        ↓ (hourly)
EventBridge Rule → Metering Job Lambda
        ↓ (aggregated batches)
SQS Queue → Metering Processor Lambda → BatchMeterUsage API
        ↓
DynamoDB (records marked as processed)
```

1. Your application tracks customer usage (API calls, data processed, users, etc.)
2. You write usage records to a staging table (DynamoDB)
3. A scheduled job aggregates pending records every hour
4. The aggregated usage is submitted to the AWS Marketplace `BatchMeterUsage` API
5. Each record is marked as processed

The key API is `BatchMeterUsage`. It accepts up to 25 usage records per call, each specifying a customer, a dimension (your pricing unit), a quantity, and a timestamp.

## Prerequisites

Before starting this lab, you must have:

- Completed the [SaaS Integration](saas-integration.md) lab (registration page, ResolveCustomer, subscriber storage)
- Pricing dimensions defined in your Marketplace listing (e.g., "ApiCalls", "DataProcessedGB", "Users")

## What the sample solution deploys for you

If you deployed the [sample CloudFormation template or Terraform module](https://github.com/kevken1000/mp-registration-Page), the entire metering pipeline is already running:

- DynamoDB MeteringRecords table with GSIs for pending records and product code queries
- Hourly EventBridge rule that triggers the aggregation Lambda
- Aggregation Lambda that queries pending records and sends batches to SQS
- SQS queue for reliable processing
- Metering processor Lambda that calls `BatchMeterUsage` and marks records as processed
- IAM roles with `aws-marketplace:BatchMeterUsage` permission

If you deployed the sample solution, skip to [Step 1: Write usage records from your application](#step-1-write-usage-records-from-your-application). If you are building the pipeline yourself, see [Reference: Pipeline code](#reference-pipeline-code) at the end of this lab.

## Step 1: Write usage records from your application

Your SaaS application writes records to the MeteringRecords DynamoDB table whenever billable usage occurs. The table name is in the stack outputs (`MeteringTableName`).

Each record needs the following attributes:

| Attribute | Type | Description |
|-----------|------|-------------|
| `customerAWSAccountId` (partition key) | String | The customer's AWS account ID |
| `create_timestamp` (sort key) | Number | Unix timestamp when the usage occurred |
| `productCode` | String | Which product the usage is for |
| `dimension` | String | The pricing dimension (e.g., "ApiCalls") |
| `quantity` | Number | How many units were consumed |
| `metering_pending` | String | Must be `"true"` for the pipeline to pick it up |

The following code example shows how to write a usage record in Node.js:

```javascript
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());

await dynamodb.send(new PutCommand({
    TableName: process.env.METERING_TABLE, // from stack outputs
    Item: {
        customerAWSAccountId: '123456789012',
        create_timestamp: Date.now(),
        productCode: 'prod-abc123',
        dimension: 'ApiCalls',
        quantity: 150,
        metering_pending: 'true'
    }
}));
```

The following code example shows the same operation in Python:

```python
import boto3
import time

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('my-stack-MeteringRecords')  # from stack outputs

table.put_item(Item={
    'customerAWSAccountId': '123456789012',
    'create_timestamp': int(time.time() * 1000),
    'productCode': 'prod-abc123',
    'dimension': 'ApiCalls',
    'quantity': 150,
    'metering_pending': 'true'
})
```

Note the following:
- Write records as close to the usage event as possible
- Usage records are not accepted more than 6 hours after the event
- Use the customer's `customerAWSAccountId` (returned by `ResolveCustomer` during registration)
- The `dimension` value must match a pricing dimension defined in your Marketplace listing

## Step 2: Verify metering is working

To verify the pipeline is processing your records:

1. Write a test record to the metering table with `metering_pending = "true"`
2. Wait for the hourly job to run, or invoke the metering job Lambda manually from the Lambda console
3. Check the metering table: the record should now have `metering_pending = "false"` and a `metering_response` with the API result
4. If `metering_failed = true`, check the `metering_response` for the error message

The following are common errors and their causes:

| Error | Cause |
|-------|-------|
| `InvalidProductCodeException` | The product code does not match your listing |
| `InvalidCustomerIdentifierException` | The customer ID or account ID is not recognized |
| `TimestampOutOfBoundsException` | The usage timestamp is more than 6 hours old |
| `ThrottlingException` | Too many requests. The SQS queue handles retry automatically |

## BatchMeterUsage API notes

- Accepts up to 25 `UsageRecords` per call
- Each call is for one `ProductCode` only
- `CustomerAWSAccountId` and `CustomerIdentifier` are mutually exclusive. AWS recommends `CustomerAWSAccountId` for new integrations
- Identical requests are idempotent and safe to retry
- Usage records must be within 6 hours of the event
- Timestamps must be in UTC

## Monitoring

Set up CloudWatch alarms for the following:

- Metering job Lambda errors (any invocation failure means usage is not being reported)
- SQS queue depth (messages piling up means the processor is failing)
- DynamoDB records where `metering_failed = true` (scan periodically or add a GSI)

## Clean up

If you deployed the sample solution and want to remove it, follow the clean up steps in the [SaaS Integration](saas-integration.md) lab.

## Conclusion

In this lab, you configured usage metering for your SaaS product on AWS Marketplace. Your application writes usage records to the MeteringRecords DynamoDB table, and the metering pipeline aggregates and submits them to the `BatchMeterUsage` API every hour.

## Reference: Pipeline code

If you are building the metering pipeline yourself instead of using the sample solution, the following sections contain the code for each component.

### Metering records table

Create a DynamoDB table with the following schema:

| Attribute | Type | Description |
|-----------|------|-------------|
| `customerAWSAccountId` (partition key) | String | The customer's AWS account ID |
| `create_timestamp` (sort key) | Number | Unix timestamp when the usage occurred |
| `productCode` | String | Which product the usage is for |
| `dimension` | String | The pricing dimension (e.g., "ApiCalls") |
| `quantity` | Number | How many units were consumed |
| `metering_pending` | String | "true" until submitted to AWS Marketplace |
| `metering_failed` | Boolean | Set to true if submission failed |
| `metering_response` | String | The API response (for debugging) |

Add a Global Secondary Index (GSI) on `metering_pending` + `create_timestamp` so you can efficiently query for records that have not been submitted yet. Optionally, add a GSI on `productCode` + `create_timestamp` to query usage by product.

### Hourly aggregation job

Create a Lambda function triggered by an EventBridge rule with the schedule expression `rate(1 hour)`. This function queries pending records and sends aggregated batches to an SQS queue.

```javascript
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());
const sqs = new SQSClient();

exports.handler = async () => {
    const result = await dynamodb.send(new QueryCommand({
        TableName: process.env.METERING_TABLE,
        IndexName: 'PendingMeteringRecordsIndex',
        KeyConditionExpression: 'metering_pending = :pending',
        ExpressionAttributeValues: { ':pending': 'true' }
    }));

    // Aggregate by product + customer + dimension
    const aggregated = {};
    for (const item of result.Items) {
        const key = `${item.productCode}:${item.customerAWSAccountId}:${item.dimension}`;
        if (!aggregated[key]) {
            aggregated[key] = {
                productCode: item.productCode,
                customerAWSAccountId: item.customerAWSAccountId,
                dimension: item.dimension,
                quantity: 0,
                records: []
            };
        }
        aggregated[key].quantity += item.quantity || 0;
        aggregated[key].records.push(item);
    }

    // Send each batch to SQS for processing
    for (const key in aggregated) {
        await sqs.send(new SendMessageCommand({
            QueueUrl: process.env.METERING_QUEUE_URL,
            MessageBody: JSON.stringify(aggregated[key])
        }));
    }
};
```

### Metering processor

Create a Lambda function triggered by the SQS queue. This function calls `BatchMeterUsage` and marks records as processed.

```javascript
const { MarketplaceMetering } = require('@aws-sdk/client-marketplace-metering');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const marketplace = new MarketplaceMetering();
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());

exports.handler = async (event) => {
    for (const record of event.Records) {
        const data = JSON.parse(record.body);
        try {
            const result = await marketplace.batchMeterUsage({
                ProductCode: data.productCode,
                UsageRecords: [{
                    Timestamp: new Date(),
                    CustomerAWSAccountId: data.customerAWSAccountId,
                    Dimension: data.dimension,
                    Quantity: data.quantity
                }]
            });

            // Mark records as processed
            for (const item of data.records) {
                await dynamodb.send(new UpdateCommand({
                    TableName: process.env.METERING_TABLE,
                    Key: {
                        customerAWSAccountId: item.customerAWSAccountId,
                        create_timestamp: item.create_timestamp
                    },
                    UpdateExpression: 'SET metering_pending = :f, metering_response = :r, metering_failed = :fail',
                    ExpressionAttributeValues: {
                        ':f': 'false',
                        ':r': JSON.stringify(result),
                        ':fail': false
                    }
                }));
            }
        } catch (error) {
            console.error('Metering error:', error);
            for (const item of data.records) {
                await dynamodb.send(new UpdateCommand({
                    TableName: process.env.METERING_TABLE,
                    Key: {
                        customerAWSAccountId: item.customerAWSAccountId,
                        create_timestamp: item.create_timestamp
                    },
                    UpdateExpression: 'SET metering_failed = :fail, metering_response = :r',
                    ExpressionAttributeValues: {
                        ':fail': true,
                        ':r': error.message
                    }
                }));
            }
        }
    }
};
```

Your Lambda execution role needs the following IAM permission:

```json
{
    "Effect": "Allow",
    "Action": "aws-marketplace:BatchMeterUsage",
    "Resource": "*"
}
```

## Resources

- [BatchMeterUsage API reference](https://docs.aws.amazon.com/marketplace/latest/APIReference/API_marketplace-metering_BatchMeterUsage.html)
- [SaaS code examples](https://docs.aws.amazon.com/marketplace/latest/userguide/saas-code-examples.html)
- [Sample solution with metering included](https://github.com/kevken1000/mp-registration-Page)
- [METERING.md reference](https://github.com/kevken1000/mp-registration-Page/blob/main/METERING.md)
