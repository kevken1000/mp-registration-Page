# AWS Marketplace SaaS Registration Page

> **Disclaimer:** This is a sample solution intended for demonstration and learning purposes. It is not intended for production use without review and modification. Use it at your own risk. Review the [Production Considerations](#production-considerations) section before deploying to a live environment.

A sample solution that deploys a branded AWS Marketplace SaaS registration landing page using CloudFormation or Terraform. Use it as a starting point and customize it for your production environment.

## What This Solves

Every SaaS product listed on AWS Marketplace needs a registration page that integrates with the Marketplace APIs (such as `ResolveCustomer` and `BatchMeterUsage`) and stores customer registration data. This template handles all of that in a single deployment.

## Quick Start

Choose CloudFormation or Terraform. Both deploy the same infrastructure in `us-east-1`.

### Option A: CloudFormation

#### AWS Console

1. Download `templates/cloudformation-template.yaml`
2. Open the [CloudFormation console](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create)
3. Upload the template, fill in the parameters (only `CompanyName` and `AdminEmail` are required)
4. Click Create stack

### AWS CLI

```bash
aws cloudformation create-stack \
    --stack-name my-marketplace-landing \
    --template-body file://templates/cloudformation-template.yaml \
    --capabilities CAPABILITY_IAM \
    --parameters \
        ParameterKey=CompanyName,ParameterValue="Your Company" \
        ParameterKey=AdminEmail,ParameterValue=admin@example.com \
    --region us-east-1
```

### Option B: Terraform

```bash
cd templates/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your company name and email
terraform init
terraform plan
terraform apply
```

### After deployment (~5 minutes)

1. Confirm the SNS email subscription
2. Copy the CloudFront URL from the stack outputs
3. Set it as the fulfillment URL in the [Marketplace Management Portal](https://aws.amazon.com/marketplace/management/products)

## How It Works

1. Deploy using CloudFormation or Terraform with your company name and email
2. Confirm the SNS email subscription
3. Set the fulfillment URL in the Marketplace Management Portal

Both options deploy everything, including the branded landing page itself. No manual file uploads needed.

## What Gets Deployed

One deployment in `us-east-1` creates:

- S3 bucket (private, CloudFront OAI) for the landing page
- CloudFront distribution with Lambda@Edge POST-to-GET redirect
- API Gateway (HTTP API) with `/register` POST route
- Lambda function for registration using `ResolveCustomer` (AWS SDK v3)
- DynamoDB Subscribers table with composite key (`productCode` + `customerAWSAccountId`)
- SNS topic for admin email notifications on new registrations
- Custom resource Lambda that auto-deploys branded `index.html` + `script.js` to S3
- Metering resources: DynamoDB table, SQS queue, CloudWatch Events hourly trigger, metering job + processor Lambdas
- EventBridge rules for subscription lifecycle events (created, amended, ended)

## Multi-Product Support

One stack handles all your products. The registration page is product-agnostic:

1. AWS Marketplace sends a `x-amzn-marketplace-token` with each customer
2. Lambda@Edge redirects the POST to a GET with the token as a query param
3. The registration Lambda calls `ResolveCustomer` which returns the `ProductCode`
4. The subscriber record is stored with `productCode` as the partition key

To add another product, just set its fulfillment URL in the Marketplace Management Portal to the same CloudFront URL.

## Region

The stack must be deployed in `us-east-1`. Lambda@Edge and ACM certificates for CloudFront require this region.

## Custom Domain

Two options:

- **Route 53:** Provide Hosted Zone ID. The stack creates the ACM certificate, validates it via DNS, and adds the A record automatically.
- **Other DNS** (GoDaddy, Cloudflare, etc.): Create an ACM certificate in us-east-1 first, provide the ARN, then add a CNAME to the CloudFront URL after deployment.

## Branding

Both templates support:
- Company logo URL
- Primary color (buttons, accents)
- Header background color
- Custom welcome message

These are passed as parameters (CloudFormation) or variables (Terraform). You can update them later with a stack update or `terraform apply`.

## Architecture

![Architecture](architecture-official.png)

```
AWS Marketplace Customer
        ↓ (subscribes)
AWS Marketplace → POST x-amzn-marketplace-token
        ↓
CloudFront → Lambda@Edge (POST → 302 GET with token)
        ↓
S3 (Branded Landing Page)
        ↓ (form submit)
API Gateway → Register Lambda → ResolveCustomer API
        ↓                              ↓
   DynamoDB (Subscribers)        Returns ProductCode
        ↓
   SNS (Admin notification)
```

## DynamoDB Schema

### Subscribers Table (`<StackName>-Subscribers`)

| Key | Attribute | Type |
|-----|-----------|------|
| HASH | `productCode` | String |
| RANGE | `customerAWSAccountId` | String |

GSI `CustomerIndex`: `customerAWSAccountId` (HASH) + `productCode` (RANGE)

Additional attributes: `customerIdentifier`, `companyName`, `contactPerson`, `contactPhone`, `contactEmail`, `registrationDate`, `status`, `totalMeteringSent` (map)

### Metering Table (`<StackName>-MeteringRecords`)

| Key | Attribute | Type |
|-----|-----------|------|
| HASH | `customerAWSAccountId` | String |
| RANGE | `create_timestamp` | Number |

GSIs: `PendingMeteringRecordsIndex` (`metering_pending` + `create_timestamp`), `ProductCodeIndex` (`productCode` + `create_timestamp`)

## Prerequisites

- AWS account with Marketplace seller registration
- SaaS product listing (Limited or Public)
- AWS CLI configured (for CloudFormation) or Terraform installed (for Terraform)
- (Optional) Custom domain + Route 53 hosted zone or pre-created ACM cert

## Files

| File | Purpose |
|------|---------|
| `templates/cloudformation-template.yaml` | The CloudFormation template |
| `templates/terraform/` | Terraform module (equivalent to the CloudFormation template) |
| `METERING.md` | Metering integration reference |
| `index.html` | Optional: web-based generator form |
| `app.js` | Optional: generator form logic |
| `generator-hosting.yaml` | Optional: CloudFormation template to host the generator |

## Production Considerations

This sample solution handles registration, metering, and subscription lifecycle out of the box. For a production deployment, consider the following:

- **Provisioning logic:** Connect the DynamoDB Subscribers table to your SaaS application so new registrations automatically trigger account creation or onboarding workflows. The table has DynamoDB Streams enabled for this purpose.
- **Entitlement checking:** For contract-based products, call `GetEntitlements` in your application to verify what tier or quantity a customer purchased. This is application-level logic that varies by product.
- **Error handling and DLQs:** Add dead-letter queues to the metering SQS queue and Lambda functions to capture failed records for retry or investigation.
- **Monitoring:** Set up CloudWatch alarms on the registration Lambda error rate, metering job failures, and DynamoDB throttling. Consider adding dashboards for subscriber counts and metering volumes.
- **WAF:** Add AWS WAF to the CloudFront distribution to protect against abuse or bot traffic on the registration page.
- **Backup:** Enable DynamoDB point-in-time recovery on both tables to protect subscriber and metering data.
- **Logging:** The Lambda functions log to CloudWatch. For production, consider structured logging and a centralized log aggregation solution.
- **Testing:** Use the [AWS Marketplace Integration Testing](https://docs.aws.amazon.com/marketplace/latest/userguide/saas-integration-testing.html) guide to test the registration flow with test customers before going public.
- **Custom registration fields:** Modify the deploy Lambda and registration Lambda to add fields specific to your product (e.g., preferred region, team size, use case).

## Known Issues

- Lambda@Edge functions take up to an hour to delete after stack deletion. For CloudFormation, use `--retain-resources RedirectFunction` if you need to delete the stack quickly. For Terraform, re-run `terraform destroy` after a few minutes if it times out.
- After updating branding parameters, run a CloudFront cache invalidation to see changes immediately.

## See Also

- [METERING.md](METERING.md) — Metering integration guide with code examples
- [AWS Marketplace SaaS Integration Reference](https://github.com/aws-samples/aws-marketplace-serverless-saas-integration)
