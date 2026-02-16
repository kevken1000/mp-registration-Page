const { MarketplaceMetering } = require('@aws-sdk/client-marketplace-metering');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const marketplace = new MarketplaceMetering();
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());
const sns = new SNSClient();

exports.handler = async (event) => {
    console.log('Processing metering records');
    const failures = [];
    for (const record of event.Records) {
        const data = JSON.parse(record.body);
        try {
            const result = await marketplace.batchMeterUsage({
                UsageRecords: [{
                    Timestamp: new Date(),
                    CustomerAWSAccountId: data.customerAWSAccountId,
                    Dimension: data.dimension,
                    Quantity: data.quantity
                }],
                ProductCode: data.productCode
            });
            console.log('Metering result for product ' + data.productCode + ':', JSON.stringify(result));
            for (const item of data.records) {
                await dynamodb.send(new UpdateCommand({
                    TableName: process.env.METERING_TABLE,
                    Key: { customerAWSAccountId: item.customerAWSAccountId, create_timestamp: item.create_timestamp },
                    UpdateExpression: 'SET metering_pending = :f, metering_response = :r, metering_failed = :fail',
                    ExpressionAttributeValues: { ':f': 'false', ':r': JSON.stringify(result), ':fail': false }
                }));
            }
            await dynamodb.send(new UpdateCommand({
                TableName: process.env.SUBSCRIBERS_TABLE,
                Key: { productCode: data.productCode, customerAWSAccountId: data.customerAWSAccountId },
                UpdateExpression: 'SET totalMeteringSent = if_not_exists(totalMeteringSent, :empty)',
                ExpressionAttributeValues: { ':empty': {} }
            }));
            await dynamodb.send(new UpdateCommand({
                TableName: process.env.SUBSCRIBERS_TABLE,
                Key: { productCode: data.productCode, customerAWSAccountId: data.customerAWSAccountId },
                UpdateExpression: 'ADD totalMeteringSent.#dim :qty',
                ExpressionAttributeNames: { '#dim': data.dimension },
                ExpressionAttributeValues: { ':qty': data.quantity }
            }));
        } catch (error) {
            console.error('Metering error for product ' + data.productCode + ':', error);
            for (const item of data.records) {
                await dynamodb.send(new UpdateCommand({
                    TableName: process.env.METERING_TABLE,
                    Key: { customerAWSAccountId: item.customerAWSAccountId, create_timestamp: item.create_timestamp },
                    UpdateExpression: 'SET metering_pending = :f, metering_failed = :fail, metering_response = :r',
                    ExpressionAttributeValues: { ':f': 'false', ':fail': true, ':r': error.message }
                }));
            }
            let tip = 'Check the error message and verify your configuration.';
            const msg = error.message || '';
            if (msg.includes('InvalidProductCode') || msg.includes('invalid') && msg.includes('ProductCode')) tip = 'The product code does not match your Marketplace listing. Verify the productCode value in the metering record matches the product code shown in your AWS Marketplace Management Portal.';
            else if (msg.includes('UsageDimension') && msg.includes('invalid')) tip = 'The dimension name does not match your Marketplace listing. Check the dimension value in the metering record and compare it to the pricing dimensions defined in your product listing. Dimension names are case-sensitive.';
            else if (msg.includes('InvalidCustomerIdentifier') || msg.includes('CustomerAWSAccountId') && msg.includes('invalid')) tip = 'The customer account ID is not recognized. Verify the customer completed registration through AWS Marketplace and the account ID matches the Subscribers table.';
            else if (msg.includes('TimestampOutOfBounds')) tip = 'The usage timestamp is more than 6 hours old. Usage records must be submitted within 6 hours of the event. This record cannot be retried as-is. Write a new record with a current timestamp.';
            else if (msg.includes('Throttling')) tip = 'The request was throttled by AWS Marketplace. This is temporary. Set metering_pending back to "true" and the next hourly job will retry it.';
            failures.push('Product: ' + data.productCode + '\nCustomer: ' + data.customerAWSAccountId + '\nDimension: ' + data.dimension + '\nQuantity: ' + data.quantity + '\nError: ' + msg + '\nHow to resolve: ' + tip);
        }
    }
    if (failures.length > 0 && process.env.SNS_TOPIC_ARN) {
        try {
            let body = 'METERING FAILURE REPORT\n' + '='.repeat(40) + '\n\n';
            body += failures.join('\n\n' + '-'.repeat(40) + '\n\n');
            body += '\n\n' + '='.repeat(40) + '\n\nHOW TO RETRY\n\nFailed records have been removed from the processing queue and will not be retried automatically. To retry after fixing the issue:\n\n1. Go to the MeteringRecords DynamoDB table\n2. Find the failed record(s) using the customerAWSAccountId and create_timestamp\n3. Update the record: set metering_pending to "true" and metering_failed to false\n4. The next hourly metering job will pick them up, or invoke the MeteringJob Lambda manually';
            await sns.send(new PublishCommand({
                TopicArn: process.env.SNS_TOPIC_ARN,
                Subject: 'Metering Failed: ' + failures.length + ' record(s)',
                Message: body
            }));
        } catch (snsErr) { console.error('SNS notification error:', snsErr); }
    }
    return { statusCode: 200 };
};
