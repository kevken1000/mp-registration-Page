# Simplify AWS Marketplace SaaS Registration Page Deployment with a CloudFormation Generator

*By [Author Name]*

[AWS Marketplace](https://aws.amazon.com/marketplace) enables software sellers to reach millions of AWS customers through a streamlined procurement experience. When listing a Software-as-a-Service (SaaS) product, sellers must host a registration landing page — the fulfillment URL where customers are redirected after subscribing. This page captures the customer's registration token, calls the [ResolveCustomer](https://docs.aws.amazon.com/marketplacemetering/latest/APIReference/API_ResolveCustomer.html) API, and provisions access to the seller's platform.

The existing [serverless SaaS integration reference](https://github.com/aws-samples/aws-marketplace-serverless-saas-integration) provides a working implementation, but requires manual setup including AWS Cloud9, AWS SAM CLI, HTML editing, and Lambda function modification. For sellers who want to get their registration page running quickly, this process can take several hours.

In this post, we introduce a web-based generator tool that produces a complete [AWS CloudFormation](https://aws.amazon.com/cloudformation/) template for deploying a branded SaaS registration landing page. The tool eliminates manual coding and infrastructure setup, allowing sellers to go from form input to a fully deployed registration page in minutes.

## Overview

The generator is a client-side web application. Sellers fill in their company details and branding preferences, and the tool outputs a downloadable CloudFormation template. The template deploys all required infrastructure as a single stack, including the branded landing page itself — no manual Amazon Simple Storage Service (Amazon S3) uploads required.

Figure 1 shows the architecture deployed by the generated template.

![Architecture diagram](architecture-official.png)
*Figure 1: Architecture of the deployed registration page infrastructure*

## How the solution works

### Customer registration flow

When a customer subscribes to a SaaS product in AWS Marketplace, the following sequence occurs:

1. AWS Marketplace redirects the customer to the seller's fulfillment URL via an HTTP POST request containing an `x-amzn-marketplace-token` parameter.
2. An [Amazon CloudFront](https://aws.amazon.com/cloudfront/) distribution receives the request. A [Lambda@Edge](https://aws.amazon.com/lambda/edge/) function intercepts the POST, extracts the token, and returns a 302 redirect to the same URL with the token as a query parameter.
3. CloudFront serves the branded registration page from a private Amazon S3 bucket using an [Origin Access Identity (OAI)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).
4. The customer completes the registration form with their company name, contact person, phone number, and email address.
5. The page submits the form data along with the registration token to an [Amazon API Gateway](https://aws.amazon.com/api-gateway/) HTTP API endpoint.
6. An [AWS Lambda](https://aws.amazon.com/lambda/) function calls the `ResolveCustomer` API to exchange the token for the `ProductCode` and `CustomerAWSAccountId`, stores the subscriber record in [Amazon DynamoDB](https://aws.amazon.com/dynamodb/), and sends a notification via [Amazon Simple Notification Service (Amazon SNS)](https://aws.amazon.com/sns/).

### The POST-to-GET redirect

AWS Marketplace sends customers to the fulfillment URL using an HTTP POST request with the registration token in the form body. Because CloudFront serves static content from Amazon S3 and does not process POST request bodies, a Lambda@Edge function handles the conversion.

The function runs on the `viewer-request` event with `IncludeBody` enabled. It decodes the POST body, extracts the `x-amzn-marketplace-token`, and returns a 302 redirect. The browser follows the redirect as a GET request, and CloudFront serves the static landing page. Client-side JavaScript then reads the token from the query string.

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
                        value: '/?x-amzn-marketplace-token=' +
                               encodeURIComponent(token)
                    }]
                }
            };
        }
    }
    return request;
};
```

### Multi-product support

A key design decision is that the registration page is product-agnostic. The `ProductCode` is not configured at deployment time. Instead, the `ResolveCustomer` API returns it at runtime from the registration token. This means a single deployed stack handles all of a seller's SaaS products.

The DynamoDB Subscribers table uses a composite primary key:

- **Partition key**: `productCode` (String)
- **Sort key**: `customerAWSAccountId` (String)

A Global Secondary Index (`CustomerIndex`) reverses this key order, enabling queries by customer account across all products. To add a new product, the seller sets its fulfillment URL in the [AWS Marketplace Management Portal](https://aws.amazon.com/marketplace/management/products) to the same CloudFront distribution URL. No infrastructure changes are required.

## What the template deploys

The generated CloudFormation template creates the following resources in a single stack:

| Resource | Service | Purpose |
|----------|---------|---------|
| Landing page hosting | Amazon S3 + Amazon CloudFront | Private S3 bucket with CloudFront OAI for HTTPS delivery |
| POST-to-GET redirect | AWS Lambda@Edge | Converts the Marketplace POST redirect to a GET request |
| Registration API | Amazon API Gateway + AWS Lambda | HTTP API with `/register` endpoint calling `ResolveCustomer` |
| Subscriber storage | Amazon DynamoDB | Composite key table supporting multiple products per customer |
| Admin notifications | Amazon SNS | Email notification on each new registration |
| Landing page deployment | AWS Lambda (Custom Resource) | Generates and uploads branded HTML/JS to S3 during stack creation |
| Metering pipeline | Amazon DynamoDB + Amazon SQS + Amazon CloudWatch Events + AWS Lambda | Hourly aggregation and submission of usage records via `BatchMeterUsage` |
| Subscription lifecycle | Amazon EventBridge + AWS Lambda | Captures agreement and license events, updates subscriber status |

### Metering infrastructure

The template includes a complete metering pipeline for sellers with usage-based pricing (SaaS Subscription or SaaS Contract with Consumption). The pipeline consists of:

1. A **Metering Records** DynamoDB table where the seller's application writes usage records.
2. An [Amazon CloudWatch Events](https://aws.amazon.com/cloudwatch/) rule that triggers a **Metering Job** Lambda function every hour.
3. The Metering Job aggregates pending records by customer, product code, and dimension, then sends batches to an [Amazon SQS](https://aws.amazon.com/sqs/) queue.
4. A **Metering Processor** Lambda function consumes the queue and calls the [BatchMeterUsage](https://docs.aws.amazon.com/marketplacemetering/latest/APIReference/API_BatchMeterUsage.html) API.
5. Each record is updated with the submission result, and cumulative totals are tracked on the subscriber record.

For sellers with contract-only pricing who do not need metering, the idle resources incur negligible cost (DynamoDB on-demand with no traffic, Lambda functions that do not execute, and SQS within the free tier).

### Subscription lifecycle events

An [Amazon EventBridge](https://aws.amazon.com/eventbridge/) rule captures AWS Marketplace agreement and license events, including:

- Purchase Agreement Created, Amended, and Ended
- License Updated and Deprovisioned

A Lambda function processes these events, updates the subscriber's status in DynamoDB, and sends an SNS notification to the seller. This eliminates the need for polling and provides near-real-time visibility into subscription changes.

## Using the generator

### Step 1: Configure your registration page

Open the generator web page (`index.html`) in a browser. The form includes the following sections:

- **Company Information** — Company name, admin email, and logo URL
- **Branding** — Primary color (buttons and accents), header background color, and a welcome message. A live preview updates as you make changes.
- **Custom Domain** (optional) — Choose between [Amazon Route 53](https://aws.amazon.com/route53/) (automated certificate and DNS) or an external DNS provider (requires a pre-created [AWS Certificate Manager](https://aws.amazon.com/certificate-manager/) certificate in `us-east-1`)
- **Deployment** — AWS Region and stack name

### Step 2: Generate the template

Click **Generate Deployment Package**. The tool produces a CloudFormation template with your configuration baked into the parameter defaults.

### Step 3: Deploy

Three deployment options are available:

**Option A: AWS Console (recommended for first-time users)**
1. Download the generated `marketplace-template.yaml` file.
2. Click **Launch in AWS Console** to open the CloudFormation console with pre-filled parameters.
3. Upload the template file, review the parameters, and choose **Create stack**.

**Option B: S3-hosted template (skip the upload step)**
1. Enter an S3 bucket name in the generator.
2. Run the provided `aws s3 cp` command to upload the template.
3. Click **Launch in AWS Console** — the template loads directly from S3.

**Option C: AWS CLI**
```bash
aws cloudformation create-stack \
    --stack-name my-marketplace-landing \
    --template-body file://marketplace-template.yaml \
    --capabilities CAPABILITY_IAM \
    --parameters \
        ParameterKey=CompanyName,ParameterValue="Your Company" \
        ParameterKey=AdminEmail,ParameterValue=admin@example.com \
    --region us-east-1
```

### Step 4: Post-deployment

1. **Confirm the SNS subscription** — Check the admin email inbox and confirm the subscription.
2. **Set the fulfillment URL** — In the [AWS Marketplace Management Portal](https://aws.amazon.com/marketplace/management/products), set the product's fulfillment URL to the CloudFront distribution URL from the stack outputs.
3. **Add more products** — For each additional SaaS product, set its fulfillment URL to the same CloudFront URL. No redeployment is needed.

## Custom domain configuration

The template supports two approaches for custom domains:

**Route 53 (fully automated):** Provide the Hosted Zone ID. The template creates an ACM certificate, validates it via DNS, creates the Route 53 A record pointing to CloudFront, and configures the CloudFront distribution with the custom domain and certificate. No manual steps required.

**External DNS provider:** Before deploying, create a public ACM certificate in `us-east-1` and complete DNS validation with your provider. Provide the certificate ARN in the generator. After deployment, add a CNAME record pointing your domain to the CloudFront distribution URL.

## Integrating metering with your application

To report usage for products with consumption-based pricing, your application writes records to the Metering Records DynamoDB table. Each record includes the customer's AWS account ID, product code, pricing dimension, and quantity.

```javascript
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());

async function recordUsage(customerAWSAccountId, productCode,
                           dimension, quantity) {
    await dynamodb.send(new PutCommand({
        TableName: process.env.METERING_TABLE,
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
```

The hourly metering job automatically picks up records with `metering_pending: "true"`, aggregates them, and submits them to the `BatchMeterUsage` API. For detailed integration guidance, see the [METERING.md](METERING.md) file in the repository.

## Operational considerations

**Lambda@Edge deletion latency** — Lambda@Edge function replicas are distributed across CloudFront edge locations and can take up to one hour to delete after the CloudFront distribution is removed. When deleting the stack, use `--retain-resources RedirectFunction` to avoid waiting for replica cleanup.

**CloudFront cache invalidation** — If you update the landing page (for example, by updating branding parameters and running a stack update), create a cache invalidation to serve the updated content immediately:

```bash
aws cloudfront create-invalidation \
    --distribution-id <DISTRIBUTION_ID> \
    --paths "/*"
```

**Custom resource stability** — The template uses a stable `PhysicalResourceId` for the custom resource that deploys the landing page files. This prevents CloudFormation from treating stack updates as resource replacements, which would delete and recreate the S3 objects.

**AWS SDK version** — All Lambda functions use the Node.js 18 runtime with AWS SDK for JavaScript v3 (`@aws-sdk/client-*`), which is included in the runtime environment.

## Cleanup

To delete the stack:

```bash
aws cloudformation delete-stack \
    --stack-name my-marketplace-landing \
    --retain-resources RedirectFunction \
    --region us-east-1
```

The `--retain-resources` flag is recommended to avoid waiting for Lambda@Edge replica deletion. You can manually delete the retained Lambda function after approximately one hour.

## Conclusion

This tool simplifies the process of deploying an AWS Marketplace SaaS registration page from a multi-hour manual setup to a form-based workflow that generates a ready-to-deploy CloudFormation template. The single-stack architecture supports multiple products, includes metering infrastructure, handles subscription lifecycle events, and deploys a branded landing page automatically.

The source code is available on GitHub: [repository link]

For more information about AWS Marketplace SaaS integration, see the following resources:

- [Step-by-Step Guide to SaaS Integration with AWS Marketplace](https://aws.amazon.com/blogs/awsmarketplace/step-by-step-guide-to-saas-integration-with-aws-marketplace/)
- [AWS Marketplace Seller Guide — SaaS Products](https://docs.aws.amazon.com/marketplace/latest/userguide/saas-products.html)
- [AWS Marketplace Serverless SaaS Integration Reference](https://github.com/aws-samples/aws-marketplace-serverless-saas-integration)

---

**About the author**

[Author Name] is a [Title] at Amazon Web Services.
