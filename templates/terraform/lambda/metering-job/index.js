const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());
const sqs = new SQSClient();

exports.handler = async (event) => {
    console.log('Starting metering job');
    try {
        const result = await dynamodb.send(new QueryCommand({
            TableName: process.env.METERING_TABLE,
            IndexName: 'PendingMeteringRecordsIndex',
            KeyConditionExpression: 'metering_pending = :pending',
            ExpressionAttributeValues: { ':pending': 'true' }
        }));
        console.log('Found ' + result.Items.length + ' pending metering records');
        const aggregated = {};
        for (const item of result.Items) {
            const key = item.productCode + ':' + item.customerAWSAccountId + ':' + item.dimension;
            if (!aggregated[key]) {
                aggregated[key] = { productCode: item.productCode, customerAWSAccountId: item.customerAWSAccountId, dimension: item.dimension, quantity: 0, records: [] };
            }
            aggregated[key].quantity += item.quantity || 0;
            aggregated[key].records.push(item);
        }
        for (const key in aggregated) {
            await sqs.send(new SendMessageCommand({
                QueueUrl: process.env.METERING_QUEUE_URL,
                MessageBody: JSON.stringify(aggregated[key])
            }));
        }
        return { statusCode: 200, body: JSON.stringify({ message: 'Metering job completed', recordsProcessed: result.Items.length }) };
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
};
