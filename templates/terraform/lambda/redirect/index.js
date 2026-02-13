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
