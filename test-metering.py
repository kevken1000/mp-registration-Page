import boto3
import time

dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
table = dynamodb.Table('mp-anycompany-MeteringRecords')

# Three records with bad dimensions to trigger failures
for i, dim in enumerate(['BadDimension1', 'BadDimension2', 'BadDimension3']):
    table.put_item(Item={
        'customerAWSAccountId': '678222115656',
        'create_timestamp': int(time.time() * 1000) + i,
        'productCode': '21bee1a048vloys14ivpxn0np',
        'dimension': dim,
        'quantity': 10 + i,
        'metering_pending': 'true'
    })
    print(f'Written: {dim}')

print('All 3 test records written')
