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
            failures.push('Product: ' + data.productCode + ' | Customer: ' + data.customerAWSAccountId + ' | Dimension: ' + data.dimension + ' | Quantity: ' + data.quantity + ' | Error: ' + error.message);
        }
    }
    if (failures.length > 0 && process.env.SNS_TOPIC_ARN) {
        try {
            await sns.send(new PublishCommand({
                TopicArn: process.env.SNS_TOPIC_ARN,
                Subject: 'Metering Failed: ' + failures.length + ' record(s)',
                Message: 'The following metering submissions failed:\n\n' + failures.join('\n\n') + '\n\nFailed records have been removed from the processing queue and will not be retried automatically.\n\nTo retry after fixing the issue, update each record in the MeteringRecords DynamoDB table:\n  - Set metering_pending to "true"\n  - Set metering_failed to false\n\nThe next hourly metering job will pick them up again.'
            }));
        } catch (snsErr) { console.error('SNS notification error:', snsErr); }
    }
    return { statusCode: 200 };
};
