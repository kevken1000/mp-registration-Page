# SaaS Integration with AWS Marketplace

This guide walks you through integrating your SaaS product with AWS Marketplace. By the end, you'll have a working registration page, customer verification, subscription lifecycle handling, and (optionally) usage metering.

## What you're building

When a customer subscribes to your SaaS product on AWS Marketplace, they need to land on your registration page to complete their setup. Your integration needs to:

1. Accept the customer from AWS Marketplace (receive a token via POST)
2. Verify the customer by calling `ResolveCustomer` (exchange the token for a customer ID)
3. Store the customer's details
4. Listen for subscription changes (new, amended, cancelled)
5. (Optional) Report usage for metered/consumption pricing

## Prerequisites

- [Registered as an AWS Marketplace seller](https://docs.aws.amazon.com/marketplace/latest/userguide/seller-account-registering.html)
- A SaaS product listing created (Limited or Public)
- `AWSMarketplaceSellerFullAccess` IAM permission
- AWS CLI configured or Console access

## Option 1: Deploy the sample solution (fastest)

A sample CloudFormation template deploys everything in one step: registration page, APIs, database, subscription handling, and metering pipeline.

```bash
aws cloudformation create-stack \
    --stack-name my-marketplace-landing \
    --template-body file://cloudformation-template.yaml \
    --capabilities CAPABILITY_IAM \
    --parameters \
        ParameterKey=CompanyName,ParameterValue="Your Company" \
        ParameterKey=AdminEmail,ParameterValue=admin@example.com \
    --region us-east-1
```

A Terraform version is also available. See the [GitHub repository](https://github.com/kevken1000/mp-registration-Page) for both options.

After deployment (~5 minutes):
1. Confirm the SNS email subscription
2. Copy the CloudFront URL from the stack outputs
3. Set it as the fulfillment URL in the [Marketplace Management Portal](https://aws.amazon.com/marketplace/management/products)

That's the entire setup. Skip to [Testing your integration](#testing-your-integration) to verify it works.

## Option 2: Build it yourself (step by step)

If you prefer to build the integration into your existing infrastructure, follow these steps.

### Step 1: Create a registration landing page

Your registration page is where AWS Marketplace sends customers after they subscribe. It can be a static HTML page or part of your existing web application.

Requirements:
- Must accept a POST request from AWS Marketplace containing `x-amzn-marketplace-token` in the request body
- Must extract the token and pass it to your backend for verification
- Must collect customer details (company name, contact info, email)

Since AWS Marketplace sends a POST request but most static pages can't handle POST bodies, you need to convert it to a GET. Two common approaches:

- **Lambda@Edge** (recommended): Intercept the POST at the CloudFront edge, extract the token, and redirect to a GET with the token as a query parameter. Fast, runs at the edge, no extra API Gateway route needed.
- **API Gateway redirect route**: Add a `/redirect` route in API Gateway that receives the POST, extracts the token, and returns a 302 redirect. The reference implementation uses this approach.

Example Lambda@Edge redirect function:

```javascript
exports.handler = async (event) => {
    const request = event.Records[0].cf.request;
    if (request.method === 'POST' && request.body && request.body.data) {
        const body = Buffer.from(request.body.data, 'base64').toString();
        const params = new URLSearchParams(body);
        const token = params.get('x-amzn-marketplace-token');
        if (token) {
            return {
                status: '302',
                statusDescription: 'Found',
                headers: {
                    location: [{
                        key: 'Location',
                        value: '/?x-amzn-marketplace-token=' + encodeURIComponent(token)
                    }]
                }
            };
        }
    }
    return request;
};
```

### Step 2: Verify the customer with ResolveCustomer

When the customer submits the registration form, your backend calls `ResolveCustomer` with the token to get their identity.

```javascript
const { MarketplaceMetering } = require('@aws-sdk/client-marketplace-metering');
const marketplace = new MarketplaceMetering();

const result = await marketplace.resolveCustomer({
    RegistrationToken: token
});

// result contains:
// - CustomerIdentifier (Marketplace-generated ID)
// - CustomerAWSAccountId (their AWS account ID)
// - ProductCode (which product they subscribed to)
```

Key points:
- The token is valid for 4 hours after the redirect
- `ResolveCustomer` must be called from the same AWS account that published the product
- The response tells you which product the customer subscribed to, so one registration page can serve multiple products
- AWS recommends using `CustomerAWSAccountId` for new integrations (over `CustomerIdentifier`)

Required IAM permission:
```json
{
    "Effect": "Allow",
    "Action": "aws-marketplace:ResolveCustomer",
    "Resource": "*"
}
```

### Step 3: Store the customer record

After verifying the customer, store their details. A DynamoDB table works well for this:

| Attribute | Description |
|-----------|-------------|
| `productCode` (partition key) | Which product they subscribed to |
| `customerAWSAccountId` (sort key) | Their AWS account ID |
| `customerIdentifier` | Marketplace-generated customer ID |
| `companyName` | From the registration form |
| `contactPerson` | From the registration form |
| `contactEmail` | From the registration form |
| `registrationDate` | Timestamp |
| `status` | `active`, `cancelled`, etc. |

Using `productCode` as the partition key and `customerAWSAccountId` as the sort key lets one table serve multiple products.

### Step 4: Send a notification

Notify your team when a new customer registers. An SNS topic with an email subscription is the simplest approach:

```javascript
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const sns = new SNSClient();

await sns.send(new PublishCommand({
    TopicArn: process.env.SNS_TOPIC_ARN,
    Subject: 'New Registration: ' + companyName,
    Message: `Company: ${companyName}\nContact: ${contactPerson}\nEmail: ${contactEmail}\nAccount: ${customerAWSAccountId}\nProduct: ${productCode}`
}));
```

### Step 5: Handle subscription lifecycle events

Customers can upgrade, downgrade, or cancel their subscriptions. You need to listen for these changes and update your records.

**Recommended approach: EventBridge**

AWS Marketplace publishes agreement and license events to EventBridge. Create a rule to capture them:

```json
{
    "source": ["aws.agreement-marketplace"],
    "detail-type": [
        "Purchase Agreement Created - Manufacturer",
        "Purchase Agreement Amended - Manufacturer",
        "Purchase Agreement Ended - Manufacturer",
        "License Updated - Manufacturer",
        "License Deprovisioned - Manufacturer"
    ]
}
```

Your Lambda handler receives the event and updates the subscriber status in DynamoDB.

**Alternative approach: SNS topics**

The older approach uses product-specific SNS topics provided by AWS Marketplace. You subscribe an SQS queue to the topic and process messages with a Lambda function. This requires the product code at setup time and needs separate subscriptions per product.

### Step 6: Set the fulfillment URL

In the [Marketplace Management Portal](https://aws.amazon.com/marketplace/management/products):

1. Select your SaaS product
2. Set the fulfillment URL to your registration page URL (CloudFront domain or custom domain)
3. Submit the update

## Testing your integration

1. Go to your product listing in the Marketplace Management Portal
2. Use the "View on AWS Marketplace" link to see the buyer experience
3. Subscribe to your own product as a test buyer
4. Verify you're redirected to your registration page with the token
5. Complete the registration form
6. Check DynamoDB for the new subscriber record
7. Check your email for the SNS notification

For detailed testing guidance, see [Successfully testing your SaaS listing in AWS Marketplace](https://aws.amazon.com/blogs/awsmarketplace/successfully-testing-your-saas-listing-in-aws-marketplace/).

## What about metering?

If your product uses usage-based pricing (SaaS Subscriptions or Contracts with Consumption), you need to report customer usage to AWS Marketplace. This is covered in a separate guide: [SaaS Metering Integration](saas-metering.md).

For contract-only products with no usage component, metering is not required.

## Architecture overview

```
AWS Marketplace Customer
        ↓ (subscribes)
AWS Marketplace → POST x-amzn-marketplace-token
        ↓
CloudFront → Lambda@Edge (POST → 302 GET with token)
        ↓
Registration Page (S3 / your web app)
        ↓ (form submit)
API Gateway → Register Lambda → ResolveCustomer API
        ↓                              ↓
   DynamoDB (Subscribers)        Returns ProductCode
        ↓
   SNS (Admin notification)

EventBridge → Subscription Event Lambda → DynamoDB (status updates)
```

## Resources

- [Sample solution (CloudFormation + Terraform)](https://github.com/kevken1000/mp-registration-Page)
- [ResolveCustomer API reference](https://docs.aws.amazon.com/marketplace/latest/APIReference/API_marketplace-metering_ResolveCustomer.html)
- [BatchMeterUsage API reference](https://docs.aws.amazon.com/marketplace/latest/APIReference/API_marketplace-metering_BatchMeterUsage.html)
- [SaaS Seller Guide](https://docs.aws.amazon.com/marketplace/latest/userguide/saas-products.html)
- [AWS Marketplace SaaS Integration Reference](https://github.com/aws-samples/aws-marketplace-serverless-saas-integration)
