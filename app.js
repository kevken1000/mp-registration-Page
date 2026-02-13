document.getElementById('deployForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const formData = {
        companyName: document.getElementById('companyName').value,
        adminEmail: document.getElementById('adminEmail').value,
        logoUrl: document.getElementById('logoUrl').value || '',
        primaryColor: document.getElementById('primaryColor').value || '#0073bb',
        headerColor: document.getElementById('headerColor').value || '#232f3e',
        welcomeMessage: document.getElementById('welcomeMessage').value || 'Complete your registration to get started',
        enableCustomDomain: document.getElementById('enableCustomDomain').checked,
        customDomain: document.getElementById('enableCustomDomain').checked ? document.getElementById('customDomain').value : '',
        dnsProvider: document.querySelector('input[name="dnsProvider"]:checked').value,
        hostedZoneId: document.getElementById('hostedZoneId').value || '',
        acmCertArn: document.getElementById('acmCertArn').value || '',
        awsRegion: 'us-east-1',
        stackName: document.getElementById('stackName').value || `mp-landing-${Date.now()}`
    };

    generateDeploymentPackage(formData);
});

function generateDeploymentPackage(config) {
    const outputSection = document.getElementById('outputSection');
    const commandsDiv = document.getElementById('deploymentCommands');
    commandsDiv.textContent = generateDeploymentCommands(config);
    outputSection.classList.add('show');
    document.getElementById('downloadLinks').innerHTML = '';
    document.getElementById('consoleLink').href = generateConsoleUrl(config);
    document.getElementById('consoleLink').dataset.baseUrl = document.getElementById('consoleLink').href;
    // Reset S3 hosting state
    document.getElementById('templateBucket').value = '';
    document.getElementById('s3UploadCmd').style.display = 'none';
    generateDownloadableFiles(config);
    outputSection.scrollIntoView({ behavior: 'smooth' });
}

function generateDeploymentCommands(config) {
    const hasCustomDomain = config.enableCustomDomain && config.customDomain;
    const isRoute53 = hasCustomDomain && config.dnsProvider === 'route53' && config.hostedZoneId;
    const isOtherDns = hasCustomDomain && config.dnsProvider === 'other' && config.acmCertArn;
    let domainParams = '';
    if (hasCustomDomain) {
        domainParams = `    ParameterKey=CustomDomain,ParameterValue="${config.customDomain}" \\\n`;
        if (isRoute53) domainParams += `    ParameterKey=HostedZoneId,ParameterValue="${config.hostedZoneId}" \\\n`;
        else if (isOtherDns) domainParams += `    ParameterKey=AcmCertificateArn,ParameterValue="${config.acmCertArn}" \\\n`;
    }
    let postDeploy = '';
    if (isOtherDns) postDeploy = `\n# Step 7: Add CNAME in your DNS:\n#   ${config.customDomain} -> <CloudFront domain from outputs>\n`;
    else if (isRoute53) postDeploy = `\n# Step 7: DNS configured automatically via Route 53!\n# Your page will be at: https://${config.customDomain}\n`;

    return `# AWS Marketplace SaaS Landing Page - ${config.companyName}
# ${hasCustomDomain ? `Domain: ${config.customDomain}` : 'Using CloudFront URL'}

# Step 1: Deploy
aws cloudformation create-stack \\
  --stack-name ${config.stackName} \\
  --template-body file://marketplace-template.yaml \\
  --capabilities CAPABILITY_IAM \\
  --parameters \\
    ParameterKey=CompanyName,ParameterValue="${config.companyName}" \\
    ParameterKey=AdminEmail,ParameterValue=${config.adminEmail} \\
${domainParams}  --region ${config.awsRegion}

# Step 2: Wait (~5 min)
aws cloudformation wait stack-create-complete \\
  --stack-name ${config.stackName} --region ${config.awsRegion}

# Step 3: Get outputs
aws cloudformation describe-stacks \\
  --stack-name ${config.stackName} --query 'Stacks[0].Outputs' --region ${config.awsRegion}

# Step 4: Landing page deploys automatically!

# Step 5: Confirm SNS email: ${config.adminEmail}

# Step 6: Set Fulfillment URL in Marketplace Management Portal
#   ${hasCustomDomain ? `https://${config.customDomain}` : 'Use CloudFront URL from outputs'}
${postDeploy}
# Multi-product: This stack handles ALL your products.
# For each additional product, just set its Fulfillment URL
# to the same CloudFront URL. No redeployment needed.
# Metering included - see METERING.md`;
}

function generateDownloadableFiles(config) {
    const template = generateCloudFormationTemplate(config);
    window._lastGeneratedTemplate = template;
    createDownloadLink('marketplace-template.yaml', template, 'text/yaml');
}

function generateCloudFormationTemplate(config) {
    const hasCustomDomain = config.enableCustomDomain && config.customDomain;
    const isRoute53 = hasCustomDomain && config.dnsProvider === 'route53' && config.hostedZoneId;
    const isOtherDns = hasCustomDomain && config.dnsProvider === 'other';

    let y = `AWSTemplateFormatVersion: '2010-09-09'
Description: 'AWS Marketplace SaaS Landing Page for ${config.companyName}'

Parameters:
  CompanyName:
    Type: String
    Default: "${config.companyName}"
  AdminEmail:
    Type: String
    Default: "${config.adminEmail}"
  CustomDomain:
    Type: String
    Default: '${hasCustomDomain ? config.customDomain : ''}'
  AcmCertificateArn:
    Type: String
    Default: '${(isOtherDns && config.acmCertArn) ? config.acmCertArn : ''}'
  HostedZoneId:
    Type: String
    Default: '${isRoute53 ? config.hostedZoneId : ''}'
  PrimaryColor:
    Type: String
    Default: '${config.primaryColor}'
  HeaderColor:
    Type: String
    Default: '${config.headerColor}'
  LogoUrl:
    Type: String
    Default: '${config.logoUrl}'
  WelcomeMessage:
    Type: String
    Default: '${config.welcomeMessage}'

Conditions:
  HasCustomDomain: !Not [!Equals [!Ref CustomDomain, '']]
  UseRoute53: !Not [!Equals [!Ref HostedZoneId, '']]
  UseExternalDns: !And
    - !Condition HasCustomDomain
    - !Equals [!Ref HostedZoneId, '']

Resources:
  LandingPageBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256

  CloudFrontOriginAccessIdentity:
    Type: AWS::CloudFront::CloudFrontOriginAccessIdentity
    Properties:
      CloudFrontOriginAccessIdentityConfig:
        Comment: !Sub 'OAI for \${AWS::StackName}'

  LandingPageBucketPolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref LandingPageBucket
      PolicyDocument:
        Statement:
          - Sid: AllowCloudFrontAccess
            Effect: Allow
            Principal:
              CanonicalUser: !GetAtt CloudFrontOriginAccessIdentity.S3CanonicalUserId
            Action: 's3:GetObject'
            Resource: !Sub '\${LandingPageBucket.Arn}/*'

  SubscribersTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub '\${AWS::StackName}-Subscribers'
      AttributeDefinitions:
        - AttributeName: productCode
          AttributeType: S
        - AttributeName: customerAWSAccountId
          AttributeType: S
      KeySchema:
        - AttributeName: productCode
          KeyType: HASH
        - AttributeName: customerAWSAccountId
          KeyType: RANGE
      BillingMode: PAY_PER_REQUEST
      StreamSpecification:
        StreamViewType: NEW_AND_OLD_IMAGES
      GlobalSecondaryIndexes:
        - IndexName: CustomerIndex
          KeySchema:
            - AttributeName: customerAWSAccountId
              KeyType: HASH
            - AttributeName: productCode
              KeyType: RANGE
          Projection:
            ProjectionType: ALL

  MeteringTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub '\${AWS::StackName}-MeteringRecords'
      AttributeDefinitions:
        - AttributeName: customerAWSAccountId
          AttributeType: S
        - AttributeName: create_timestamp
          AttributeType: N
        - AttributeName: metering_pending
          AttributeType: S
        - AttributeName: productCode
          AttributeType: S
      KeySchema:
        - AttributeName: customerAWSAccountId
          KeyType: HASH
        - AttributeName: create_timestamp
          KeyType: RANGE
      BillingMode: PAY_PER_REQUEST
      GlobalSecondaryIndexes:
        - IndexName: PendingMeteringRecordsIndex
          KeySchema:
            - AttributeName: metering_pending
              KeyType: HASH
            - AttributeName: create_timestamp
              KeyType: RANGE
          Projection:
            ProjectionType: ALL
        - IndexName: ProductCodeIndex
          KeySchema:
            - AttributeName: productCode
              KeyType: HASH
            - AttributeName: create_timestamp
              KeyType: RANGE
          Projection:
            ProjectionType: ALL
`;

    y += `  LambdaExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: 'sts:AssumeRole'
      ManagedPolicyArns:
        - 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
      Policies:
        - PolicyName: MarketplaceAccess
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - 'aws-marketplace:ResolveCustomer'
                  - 'aws-marketplace:BatchMeterUsage'
                Resource: '*'
              - Effect: Allow
                Action:
                  - 'dynamodb:PutItem'
                  - 'dynamodb:GetItem'
                  - 'dynamodb:UpdateItem'
                  - 'dynamodb:Query'
                  - 'dynamodb:Scan'
                Resource:
                  - !GetAtt SubscribersTable.Arn
                  - !Sub '\${SubscribersTable.Arn}/index/*'
                  - !GetAtt MeteringTable.Arn
                  - !Sub '\${MeteringTable.Arn}/index/*'
              - Effect: Allow
                Action:
                  - 'sqs:SendMessage'
                  - 'sqs:ReceiveMessage'
                  - 'sqs:DeleteMessage'
                  - 'sqs:GetQueueAttributes'
                Resource: !GetAtt MeteringQueue.Arn
              - Effect: Allow
                Action:
                  - 'sns:Publish'
                Resource: !Ref NotificationTopic

  EdgeLambdaExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service:
                - lambda.amazonaws.com
                - edgelambda.amazonaws.com
            Action: 'sts:AssumeRole'
      ManagedPolicyArns:
        - 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'

  RedirectFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: !Sub '\${AWS::StackName}-Redirect'
      Runtime: nodejs18.x
      Handler: index.handler
      Role: !GetAtt EdgeLambdaExecutionRole.Arn
      Code:
        ZipFile: |
          exports.handler = async (event) => {
              const request = event.Records[0].cf.request;
              if (request.method === 'POST' && request.body && request.body.data) {
                  const body = Buffer.from(request.body.data, 'base64').toString();
                  const params = new URLSearchParams(body);
                  const token = params.get('x-amzn-marketplace-token');
                  if (token) {
                      return { status: '302', statusDescription: 'Found', headers: { location: [{ key: 'Location', value: '/?x-amzn-marketplace-token=' + encodeURIComponent(token) }] } };
                  }
              }
              return request;
          };

  RedirectFunctionVersion:
    Type: AWS::Lambda::Version
    Properties:
      FunctionName: !Ref RedirectFunction

  RegisterFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: !Sub '\${AWS::StackName}-RegisterSubscriber'
      Runtime: nodejs18.x
      Handler: index.handler
      Role: !GetAtt LambdaExecutionRole.Arn
      Environment:
        Variables:
          SUBSCRIBERS_TABLE: !Ref SubscribersTable
          SNS_TOPIC_ARN: !Ref NotificationTopic
      Code:
        ZipFile: |
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
                      Item: { productCode: ProductCode, customerAWSAccountId: CustomerAWSAccountId, customerIdentifier: CustomerIdentifier, companyName, contactPerson, contactPhone, contactEmail, registrationDate: new Date().toISOString(), status: 'active' }
                  }));
                  if (process.env.SNS_TOPIC_ARN) {
                      await sns.send(new PublishCommand({ TopicArn: process.env.SNS_TOPIC_ARN, Subject: 'New Registration: ' + companyName, Message: 'Company: ' + companyName + '\\nContact: ' + contactPerson + '\\nEmail: ' + contactEmail + '\\nAccount: ' + CustomerAWSAccountId + '\\nProduct: ' + ProductCode }));
                  }
                  return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ message: 'Registration successful', customerAWSAccountId: CustomerAWSAccountId }) };
              } catch (error) {
                  console.error('Error:', error);
                  return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: error.message }) };
              }
          };
`;

    y += `  MeteringJobFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: !Sub '\${AWS::StackName}-MeteringJob'
      Runtime: nodejs18.x
      Handler: index.handler
      Role: !GetAtt LambdaExecutionRole.Arn
      Timeout: 300
      Environment:
        Variables:
          METERING_TABLE: !Ref MeteringTable
          METERING_QUEUE_URL: !Ref MeteringQueue
      Code:
        ZipFile: |
          const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
          const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
          const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
          const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());
          const sqs = new SQSClient();
          exports.handler = async () => {
              console.log('Starting metering job');
              const result = await dynamodb.send(new QueryCommand({ TableName: process.env.METERING_TABLE, IndexName: 'PendingMeteringRecordsIndex', KeyConditionExpression: 'metering_pending = :p', ExpressionAttributeValues: { ':p': 'true' } }));
              console.log('Found ' + result.Items.length + ' pending records');
              const agg = {};
              for (const item of result.Items) {
                  const k = item.productCode + ':' + item.customerAWSAccountId + ':' + item.dimension;
                  if (!agg[k]) agg[k] = { productCode: item.productCode, customerAWSAccountId: item.customerAWSAccountId, dimension: item.dimension, quantity: 0, records: [] };
                  agg[k].quantity += item.quantity || 0;
                  agg[k].records.push(item);
              }
              for (const k in agg) await sqs.send(new SendMessageCommand({ QueueUrl: process.env.METERING_QUEUE_URL, MessageBody: JSON.stringify(agg[k]) }));
              return { statusCode: 200, body: JSON.stringify({ processed: result.Items.length }) };
          };

  MeteringProcessorFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: !Sub '\${AWS::StackName}-MeteringProcessor'
      Runtime: nodejs18.x
      Handler: index.handler
      Role: !GetAtt LambdaExecutionRole.Arn
      Timeout: 60
      Environment:
        Variables:
          METERING_TABLE: !Ref MeteringTable
          SUBSCRIBERS_TABLE: !Ref SubscribersTable
      Code:
        ZipFile: |
          const { MarketplaceMetering } = require('@aws-sdk/client-marketplace-metering');
          const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
          const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
          const marketplace = new MarketplaceMetering();
          const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());
          exports.handler = async (event) => {
              for (const record of event.Records) {
                  const data = JSON.parse(record.body);
                  try {
                      const result = await marketplace.batchMeterUsage({ UsageRecords: [{ Timestamp: new Date(), CustomerAWSAccountId: data.customerAWSAccountId, Dimension: data.dimension, Quantity: data.quantity }], ProductCode: data.productCode });
                      console.log('Metered ' + data.productCode + ':', JSON.stringify(result));
                      for (const item of data.records) {
                          await dynamodb.send(new UpdateCommand({ TableName: process.env.METERING_TABLE, Key: { customerAWSAccountId: item.customerAWSAccountId, create_timestamp: item.create_timestamp }, UpdateExpression: 'SET metering_pending = :f, metering_response = :r, metering_failed = :fail', ExpressionAttributeValues: { ':f': 'false', ':r': JSON.stringify(result), ':fail': false } }));
                      }
                      await dynamodb.send(new UpdateCommand({ TableName: process.env.SUBSCRIBERS_TABLE, Key: { productCode: data.productCode, customerAWSAccountId: data.customerAWSAccountId }, UpdateExpression: 'SET totalMeteringSent = if_not_exists(totalMeteringSent, :empty)', ExpressionAttributeValues: { ':empty': {} } }));
                      await dynamodb.send(new UpdateCommand({ TableName: process.env.SUBSCRIBERS_TABLE, Key: { productCode: data.productCode, customerAWSAccountId: data.customerAWSAccountId }, UpdateExpression: 'ADD totalMeteringSent.#dim :qty', ExpressionAttributeNames: { '#dim': data.dimension }, ExpressionAttributeValues: { ':qty': data.quantity } }));
                  } catch (error) {
                      console.error('Metering error:', error);
                      for (const item of data.records) {
                          await dynamodb.send(new UpdateCommand({ TableName: process.env.METERING_TABLE, Key: { customerAWSAccountId: item.customerAWSAccountId, create_timestamp: item.create_timestamp }, UpdateExpression: 'SET metering_failed = :fail, metering_response = :r', ExpressionAttributeValues: { ':fail': true, ':r': error.message } }));
                      }
                  }
              }
              return { statusCode: 200 };
          };

  MeteringQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub '\${AWS::StackName}-MeteringQueue'
      VisibilityTimeout: 120

  MeteringProcessorEventSource:
    Type: AWS::Lambda::EventSourceMapping
    Properties:
      EventSourceArn: !GetAtt MeteringQueue.Arn
      FunctionName: !Ref MeteringProcessorFunction
      BatchSize: 10

  MeteringSchedule:
    Type: AWS::Events::Rule
    Properties:
      Description: Trigger metering job every hour
      ScheduleExpression: rate(1 hour)
      State: ENABLED
      Targets:
        - Arn: !GetAtt MeteringJobFunction.Arn
          Id: MeteringJobTarget

  MeteringSchedulePermission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref MeteringJobFunction
      Action: lambda:InvokeFunction
      Principal: events.amazonaws.com
      SourceArn: !GetAtt MeteringSchedule.Arn

  SubscriptionEventRule:
    Type: AWS::Events::Rule
    Properties:
      Description: Capture AWS Marketplace agreement and license events
      EventPattern:
        source:
          - aws.agreement-marketplace
        detail-type:
          - Purchase Agreement Created - Proposer
          - Purchase Agreement Created - Manufacturer
          - Purchase Agreement Amended - Proposer
          - Purchase Agreement Amended - Manufacturer
          - Purchase Agreement Ended - Proposer
          - Purchase Agreement Ended - Manufacturer
          - License Updated - Manufacturer
          - License Deprovisioned - Manufacturer
      State: ENABLED
      Targets:
        - Arn: !GetAtt SubscriptionEventFunction.Arn
          Id: SubscriptionEventTarget

  SubscriptionEventPermission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref SubscriptionEventFunction
      Action: lambda:InvokeFunction
      Principal: events.amazonaws.com
      SourceArn: !GetAtt SubscriptionEventRule.Arn

  SubscriptionEventFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: !Sub '\${AWS::StackName}-SubscriptionEvent'
      Runtime: nodejs18.x
      Handler: index.handler
      Role: !GetAtt LambdaExecutionRole.Arn
      Timeout: 30
      Environment:
        Variables:
          SUBSCRIBERS_TABLE: !Ref SubscribersTable
          SNS_TOPIC_ARN: !Ref NotificationTopic
      Code:
        ZipFile: |
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
              if (detailType.startsWith('Purchase Agreement Created')) { action = 'SUBSCRIPTION_CREATED'; newStatus = 'active'; }
              else if (detailType.startsWith('Purchase Agreement Amended')) { action = 'SUBSCRIPTION_AMENDED'; newStatus = 'active'; }
              else if (detailType.startsWith('Purchase Agreement Ended')) { action = 'SUBSCRIPTION_ENDED'; newStatus = 'cancelled'; }
              else if (detailType.startsWith('License Updated')) { action = 'LICENSE_UPDATED'; newStatus = 'active'; }
              else if (detailType.startsWith('License Deprovisioned')) { action = 'LICENSE_DEPROVISIONED'; newStatus = 'inactive'; }
              else { console.log('Unknown event type:', detailType); return; }
              if (acceptorAccountId) {
                  try {
                      const result = await dynamodb.send(new QueryCommand({ TableName: process.env.SUBSCRIBERS_TABLE, IndexName: 'CustomerIndex', KeyConditionExpression: 'customerAWSAccountId = :acct', ExpressionAttributeValues: { ':acct': acceptorAccountId } }));
                      for (const item of (result.Items || [])) {
                          if (productCode && item.productCode !== productCode) continue;
                          await dynamodb.send(new UpdateCommand({ TableName: process.env.SUBSCRIBERS_TABLE, Key: { productCode: item.productCode, customerAWSAccountId: acceptorAccountId }, UpdateExpression: 'SET #s = :status, lastEvent = :evt, lastEventTime = :t, agreementId = :agr', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':status': newStatus, ':evt': action, ':t': event.time, ':agr': agreementId || 'N/A' } }));
                          console.log('Updated subscriber:', item.productCode, acceptorAccountId, '->', newStatus);
                      }
                  } catch (err) { console.error('Error updating subscriber:', err); }
              }
              try {
                  await sns.send(new PublishCommand({ TopicArn: process.env.SNS_TOPIC_ARN, Subject: 'Marketplace Event: ' + action, Message: 'Event: ' + detailType + '\\nAccount: ' + (acceptorAccountId || 'N/A') + '\\nAgreement: ' + (agreementId || 'N/A') + '\\nProduct: ' + (productCode || 'N/A') + '\\nNew Status: ' + newStatus + '\\nTime: ' + event.time }));
              } catch (err) { console.error('SNS error:', err); }
          };
`;

    y += `  ApiGateway:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: !Sub '\${AWS::StackName}-API'
      ProtocolType: HTTP
      CorsConfiguration:
        AllowOrigins: ['*']
        AllowMethods: [POST, OPTIONS]
        AllowHeaders: ['*']

  ApiIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref ApiGateway
      IntegrationType: AWS_PROXY
      IntegrationUri: !GetAtt RegisterFunction.Arn
      PayloadFormatVersion: '2.0'

  ApiRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref ApiGateway
      RouteKey: 'POST /register'
      Target: !Sub 'integrations/\${ApiIntegration}'

  ApiStage:
    Type: AWS::ApiGatewayV2::Stage
    Properties:
      ApiId: !Ref ApiGateway
      StageName: '$default'
      AutoDeploy: true

  LambdaApiPermission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref RegisterFunction
      Action: lambda:InvokeFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub 'arn:aws:execute-api:\${AWS::Region}:\${AWS::AccountId}:\${ApiGateway}/*'
`;

    y += `  CloudFrontDistribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Enabled: true
        DefaultRootObject: index.html
        Aliases: !If
          - HasCustomDomain
          - [!Ref CustomDomain]
          - !Ref 'AWS::NoValue'
        ViewerCertificate: !If
          - UseRoute53
          - AcmCertificateArn: !Ref Route53Certificate
            SslSupportMethod: sni-only
            MinimumProtocolVersion: TLSv1.2_2021
          - !If
            - UseExternalDns
            - AcmCertificateArn: !Ref AcmCertificateArn
              SslSupportMethod: sni-only
              MinimumProtocolVersion: TLSv1.2_2021
            - CloudFrontDefaultCertificate: true
        Origins:
          - DomainName: !GetAtt LandingPageBucket.RegionalDomainName
            Id: S3Origin
            S3OriginConfig:
              OriginAccessIdentity: !Sub 'origin-access-identity/cloudfront/\${CloudFrontOriginAccessIdentity}'
        DefaultCacheBehavior:
          TargetOriginId: S3Origin
          ViewerProtocolPolicy: redirect-to-https
          AllowedMethods: [GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE]
          CachedMethods: [GET, HEAD]
          ForwardedValues:
            QueryString: true
            Cookies:
              Forward: none
          Compress: true
          LambdaFunctionAssociations:
            - EventType: viewer-request
              IncludeBody: true
              LambdaFunctionARN: !Ref RedirectFunctionVersion

  Route53Certificate:
    Type: AWS::CertificateManager::Certificate
    Condition: UseRoute53
    Properties:
      DomainName: !Ref CustomDomain
      ValidationMethod: DNS
      DomainValidationOptions:
        - DomainName: !Ref CustomDomain
          HostedZoneId: !Ref HostedZoneId
`;

    y += `  Route53DnsRecord:
    Type: AWS::Route53::RecordSet
    Condition: UseRoute53
    Properties:
      HostedZoneId: !Ref HostedZoneId
      Name: !Ref CustomDomain
      Type: A
      AliasTarget:
        HostedZoneId: Z2FDTNDATAQYW2
        DNSName: !GetAtt CloudFrontDistribution.DomainName

  NotificationTopic:
    Type: AWS::SNS::Topic
    Properties:
      DisplayName: !Sub '\${CompanyName} Marketplace Notifications'
      Subscription:
        - Endpoint: !Ref AdminEmail
          Protocol: email

  DeployLandingPageRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: 'sts:AssumeRole'
      ManagedPolicyArns:
        - 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
      Policies:
        - PolicyName: S3Deploy
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: ['s3:PutObject', 's3:DeleteObject']
                Resource: !Sub '\${LandingPageBucket.Arn}/*'
`;

    y += `  DeployLandingPageFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: !Sub '\${AWS::StackName}-DeployLandingPage'
      Runtime: nodejs18.x
      Handler: index.handler
      Role: !GetAtt DeployLandingPageRole.Arn
      Timeout: 60
      Environment:
        Variables:
          BUCKET: !Ref LandingPageBucket
          API_URL: !Sub 'https://\${ApiGateway}.execute-api.\${AWS::Region}.amazonaws.com/register'
          COMPANY: !Ref CompanyName
          COLOR1: !Ref PrimaryColor
          COLOR2: !Ref HeaderColor
          LOGO: !Ref LogoUrl
          WELCOME: !Ref WelcomeMessage
      Code:
        ZipFile: |
          const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
          const https = require('https');
          const url = require('url');
          const s3 = new S3Client();
          const respond = (ev, ctx, status, data) => {
            const b = JSON.stringify({Status:status,Reason:'Log:'+ctx.logStreamName,PhysicalResourceId:'deploy-landing-page',StackId:ev.StackId,RequestId:ev.RequestId,LogicalResourceId:ev.LogicalResourceId,Data:data||{}});
            const p = url.parse(ev.ResponseURL);
            return new Promise((ok,fail) => {const r=https.request({hostname:p.hostname,port:443,path:p.path,method:'PUT',headers:{'content-type':'','content-length':b.length}},ok);r.on('error',fail);r.write(b);r.end();});
          };
          exports.handler = async (ev, ctx) => {
            try {
              if (ev.RequestType === 'Delete') {
                try{await s3.send(new DeleteObjectCommand({Bucket:process.env.BUCKET,Key:'index.html'}))}catch(e){}
                try{await s3.send(new DeleteObjectCommand({Bucket:process.env.BUCKET,Key:'script.js'}))}catch(e){}
                await respond(ev,ctx,'SUCCESS');
                return;
              }
              const e = process.env;
              const logo = e.LOGO ? '<img style="height:32px" src="'+e.LOGO+'" alt="'+e.COMPANY+'">' : '';
              const yr = new Date().getFullYear();
`;
    y += `              const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>'+e.COMPANY+' - Registration</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f2f3f3;color:#16191f;min-height:100vh}.top-bar{background:'+e.COLOR2+';height:56px;display:flex;align-items:center;padding:0 24px}.top-bar-brand{display:flex;align-items:center;gap:12px;text-decoration:none}.top-bar-brand span{color:#fff;font-size:18px;font-weight:700}.main-content{max-width:560px;margin:48px auto;padding:0 24px}.page-header{margin-bottom:24px}.page-header h1{font-size:28px;font-weight:700;margin-bottom:8px}.page-header p{font-size:14px;color:#545b64;line-height:1.6}.card{background:#fff;border:1px solid #d5dbdb;border-radius:8px;padding:32px}.card-header{font-size:18px;font-weight:700;padding-bottom:16px;margin-bottom:24px;border-bottom:1px solid #eaeded}.ff{margin-bottom:20px}.ff label{display:block;font-size:14px;font-weight:700;margin-bottom:6px}.ff input{width:100%;padding:8px 12px;font-size:14px;font-family:inherit;border:1px solid #aab7b8;border-radius:4px;outline:none}.ff input:focus{border-color:'+e.COLOR1+';box-shadow:0 0 0 1px '+e.COLOR1+'}.req{color:#d13212}.alert{padding:12px 16px;border-radius:4px;font-size:14px;margin-bottom:20px}.alert-info{background:#f1faff;border:1px solid '+e.COLOR1+';color:'+e.COLOR1+'}.alert-success{background:#f2f8f0;border:1px solid #1d8102;color:#1d8102}.alert-danger{background:#fdf3f1;border:1px solid #d13212;color:#d13212}.btn{background:'+e.COLOR1+';color:#fff;border:none;padding:10px 20px;font-size:14px;font-family:inherit;font-weight:700;border-radius:4px;cursor:pointer;width:100%}.btn:hover{opacity:.9}.btn:disabled{opacity:.5;cursor:not-allowed}.divider{height:1px;background:#eaeded;margin:24px 0}.footer{text-align:center;padding:24px;font-size:12px;color:#545b64}</style></head><body><div class="top-bar"><a class="top-bar-brand" href="#">'+logo+'<span>'+e.COMPANY+'</span></a></div><div class="main-content"><div class="page-header"><h1>Welcome to '+e.COMPANY+'</h1><p>'+e.WELCOME+'</p></div><div id="alert"></div><div class="card"><div class="card-header">Account details</div><form id="registrationForm"><div class="ff"><label>Company name <span class="req">*</span></label><input type="text" name="companyName" required></div><div class="ff"><label>Contact person <span class="req">*</span></label><input type="text" name="contactPerson" required></div><div class="ff"><label>Contact phone <span class="req">*</span></label><input type="tel" name="contactPhone" required></div><div class="ff"><label>Email address <span class="req">*</span></label><input type="email" name="contactEmail" required></div><div class="divider"></div><button class="btn" type="submit">Complete registration</button></form></div><div class="footer">&copy; '+yr+' '+e.COMPANY+'</div></div><script src="script.js"></script></body></html>';
`;
    y += `              const js = 'const API="'+e.API_URL+'";window.addEventListener("DOMContentLoaded",function(){var t=new URLSearchParams(window.location.search).get("x-amzn-marketplace-token");t||showAlert("info","This page is accessed via AWS Marketplace. Registration works once customers subscribe through AWS Marketplace.")});document.getElementById("registrationForm").addEventListener("submit",async function(ev){ev.preventDefault();var t=new URLSearchParams(window.location.search).get("x-amzn-marketplace-token");if(!t){showAlert("error","Invalid registration link. Please use the link from AWS Marketplace.");return}var f=new FormData(ev.target);var d={regToken:t,companyName:f.get("companyName"),contactPerson:f.get("contactPerson"),contactPhone:f.get("contactPhone"),contactEmail:f.get("contactEmail")};var b=ev.target.querySelector("button[type=submit]");var o=b.textContent;b.disabled=true;b.textContent="Registering...";try{var r=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});var j=await r.json();r.ok?showAlert("success","Registration successful! We will be in touch to provide you access to the SaaS platform."):showAlert("error",j.error||"Registration failed.")}catch(e){showAlert("error","Network error. Please try again.")}finally{b.disabled=false;b.textContent=o}});function showAlert(t,m){document.getElementById("alert").innerHTML="<div class=\\"alert alert-"+(t==="success"?"success":t==="error"?"danger":"info")+"\\" role=\\"alert\\">"+m+"</div>"}';
              await s3.send(new PutObjectCommand({Bucket:e.BUCKET,Key:'index.html',Body:html,ContentType:'text/html'}));
              await s3.send(new PutObjectCommand({Bucket:e.BUCKET,Key:'script.js',Body:js,ContentType:'application/javascript'}));
              await respond(ev,ctx,'SUCCESS',{Message:'Deployed'});
              return;
            } catch(err) {
              console.error(err);
              await respond(ev,ctx,'FAILED',{Error:err.message});
            }
          };

  DeployLandingPage:
    Type: AWS::CloudFormation::CustomResource
    DependsOn: [LandingPageBucketPolicy, ApiStage]
    Properties:
      ServiceToken: !GetAtt DeployLandingPageFunction.Arn
      Version: '5'

Outputs:
  LandingPageBucket:
    Value: !Ref LandingPageBucket
  CloudFrontURL:
    Value: !GetAtt CloudFrontDistribution.DomainName
  CustomDomainURL:
    Condition: HasCustomDomain
    Value: !Sub 'https://\${CustomDomain}'
  ApiEndpoint:
    Value: !Sub 'https://\${ApiGateway}.execute-api.\${AWS::Region}.amazonaws.com/register'
  SubscribersTable:
    Value: !Ref SubscribersTable
  MeteringTable:
    Value: !Ref MeteringTable
  MeteringQueue:
    Value: !Ref MeteringQueue`;

    return y;
}

function generateConsoleUrl(config) {
    const region = config.awsRegion || 'us-east-1';
    const hasCustomDomain = config.enableCustomDomain && config.customDomain;
    const isRoute53 = hasCustomDomain && config.dnsProvider === 'route53' && config.hostedZoneId;
    const isOtherDns = hasCustomDomain && config.dnsProvider === 'other';
    const params = new URLSearchParams();
    params.set('stackName', config.stackName);
    params.set('param_CompanyName', config.companyName);
    params.set('param_AdminEmail', config.adminEmail);
    if (hasCustomDomain) params.set('param_CustomDomain', config.customDomain);
    if (isRoute53) params.set('param_HostedZoneId', config.hostedZoneId);
    if (isOtherDns && config.acmCertArn) params.set('param_AcmCertificateArn', config.acmCertArn);
    // Store params for later use by S3 hosting
    window._cfParams = params;
    window._cfRegion = region;
    return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create?${params.toString()}`;
}

function generateConsoleUrlWithTemplate(templateUrl) {
    const region = window._cfRegion || 'us-east-1';
    const params = new URLSearchParams(window._cfParams);
    params.set('templateURL', templateUrl);
    return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create/review?${params.toString()}`;
}

function updateS3Url() {
    const bucket = document.getElementById('templateBucket').value.trim();
    if (!bucket) return;
    const region = window._cfRegion || 'us-east-1';
    const s3Url = `https://${bucket}.s3.${region}.amazonaws.com/marketplace-template.yaml`;
    const uploadCmd = `aws s3 mb s3://${bucket} --region ${region}\naws s3 cp marketplace-template.yaml s3://${bucket}/marketplace-template.yaml --region ${region}`;
    document.getElementById('s3CmdText').textContent = uploadCmd;
    document.getElementById('s3UploadCmd').style.display = 'block';
    const link = document.getElementById('consoleLink');
    link.dataset.baseUrl = link.dataset.baseUrl || link.href;
    link.href = generateConsoleUrlWithTemplate(s3Url);
}

function copyS3Cmd() {
    const cmd = document.getElementById('s3CmdText').textContent;
    navigator.clipboard.writeText(cmd).then(() => {
        const btn = document.getElementById('s3CmdBlock').querySelector('button');
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    });
}

function createDownloadLink(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.textContent = `Download ${filename}`;
    a.style.cssText = 'display:inline-block;margin-right:12px;margin-bottom:8px;padding:6px 14px;background:#545b64;color:white;border-radius:4px;text-decoration:none;font-size:13px;font-family:inherit;';
    document.getElementById('downloadLinks').appendChild(a);
}

function copyCommands() {
    const commands = document.getElementById('deploymentCommands').textContent;
    navigator.clipboard.writeText(commands).then(() => {
        const btn = document.querySelector('.copy-btn');
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = originalText; }, 2000);
    });
}
