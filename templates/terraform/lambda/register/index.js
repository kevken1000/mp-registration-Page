const { MarketplaceMetering } = require('@aws-sdk/client-marketplace-metering');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const marketplace = new MarketplaceMetering();
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());
const sns = new SNSClient();

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event));
    const body = JSON.parse(event.body);
    const { regToken, companyName, contactPerson, contactPhone, contactEmail } = body;
    if (!regToken || !companyName || !contactPerson || !contactPhone || !contactEmail) {
        return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Missing required fields' }) };
    }
    try {
        const resolveResponse = await marketplace.resolveCustomer({ RegistrationToken: regToken });
        const { CustomerIdentifier, ProductCode, CustomerAWSAccountId } = resolveResponse;
        await dynamodb.send(new PutCommand({
            TableName: process.env.SUBSCRIBERS_TABLE,
            Item: {
                productCode: ProductCode,
                customerAWSAccountId: CustomerAWSAccountId,
                customerIdentifier: CustomerIdentifier,
                companyName, contactPerson, contactPhone, contactEmail,
                registrationDate: new Date().toISOString(),
                status: 'active'
            }
        }));
        if (process.env.SNS_TOPIC_ARN) {
            await sns.send(new PublishCommand({
                TopicArn: process.env.SNS_TOPIC_ARN,
                Subject: 'New AWS Marketplace Registration: ' + companyName,
                Message: 'New customer registered.\nCompany: ' + companyName + '\nContact: ' + contactPerson + '\nEmail: ' + contactEmail + '\nPhone: ' + contactPhone + '\nAccount ID: ' + CustomerAWSAccountId + '\nProduct Code: ' + ProductCode
            }));
        }
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ message: 'Registration successful', customerAWSAccountId: CustomerAWSAccountId }) };
    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: error.message }) };
    }
};
