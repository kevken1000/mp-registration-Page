import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

await dynamodb.send(new PutCommand({
    TableName: 'mp-anycompany-MeteringRecords',
    Item: {
        customerAWSAccountId: '123456789012',
        create_timestamp: Date.now(),
        productCode: 'prod-abc123',
        dimension: 'ApiCalls',
        quantity: 150,
        metering_pending: 'true'
    }
}));

console.log('Usage record written successfully');
