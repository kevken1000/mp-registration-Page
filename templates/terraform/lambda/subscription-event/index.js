const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());
const sns = new SNSClient();

exports.handler = async (event) => {
    console.log('EventBridge event:', JSON.stringify(event));
    const detailType = event['detail-type'];
    const detail = event.detail;
    const acceptorAccountId = detail.acceptor ? detail.acceptor.accountId : null;
    const agreementId = detail.agreement ? detail.agreement.id : null;
    const productCode = detail.product ? detail.product.code : null;
    let action, newStatus;
    if (detailType.startsWith('Purchase Agreement Created')) {
        action = 'SUBSCRIPTION_CREATED'; newStatus = 'active';
    } else if (detailType.startsWith('Purchase Agreement Amended')) {
        action = 'SUBSCRIPTION_AMENDED'; newStatus = 'active';
    } else if (detailType.startsWith('Purchase Agreement Ended')) {
        action = 'SUBSCRIPTION_ENDED'; newStatus = 'cancelled';
    } else if (detailType.startsWith('License Updated')) {
        action = 'LICENSE_UPDATED'; newStatus = 'active';
    } else if (detailType.startsWith('License Deprovisioned')) {
        action = 'LICENSE_DEPROVISIONED'; newStatus = 'inactive';
    } else {
        console.log('Unknown event type:', detailType);
        return;
    }
    if (acceptorAccountId) {
        try {
            const result = await dynamodb.send(new QueryCommand({
                TableName: process.env.SUBSCRIBERS_TABLE,
                IndexName: 'CustomerIndex',
                KeyConditionExpression: 'customerAWSAccountId = :acct',
                ExpressionAttributeValues: { ':acct': acceptorAccountId }
            }));
            for (const item of (result.Items || [])) {
                if (productCode && item.productCode !== productCode) continue;
                await dynamodb.send(new UpdateCommand({
                    TableName: process.env.SUBSCRIBERS_TABLE,
                    Key: { productCode: item.productCode, customerAWSAccountId: acceptorAccountId },
                    UpdateExpression: 'SET #s = :status, lastEvent = :evt, lastEventTime = :t, agreementId = :agr',
                    ExpressionAttributeNames: { '#s': 'status' },
                    ExpressionAttributeValues: {
                        ':status': newStatus,
                        ':evt': action,
                        ':t': event.time,
                        ':agr': agreementId || 'N/A'
                    }
                }));
                console.log('Updated subscriber:', item.productCode, acceptorAccountId, '->', newStatus);
            }
        } catch (err) {
            console.error('Error updating subscriber:', err);
        }
    }
    try {
        await sns.send(new PublishCommand({
            TopicArn: process.env.SNS_TOPIC_ARN,
            Subject: 'Marketplace Event: ' + action,
            Message: 'Event: ' + detailType + '\nAccount: ' + (acceptorAccountId || 'N/A') + '\nAgreement: ' + (agreementId || 'N/A') + '\nProduct: ' + (productCode || 'N/A') + '\nNew Status: ' + newStatus + '\nTime: ' + event.time
        }));
    } catch (err) {
        console.error('SNS error:', err);
    }
};
