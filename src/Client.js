import request from 'request';


export default class Client {
  constructor({ token, timeout = 10000 }) {
    this.token = token;
    this.timeout = timeout;
  }

  callApi(method = 'api.test', params = {}) {
    return new Promise((resolve, reject) => {
      params.token = params.token || this.token;
      request({
        uri: `https://slack.com/api/${method}`,
        qs: params,
        json: true,
        timeout: 5000,
      }, (error, response) => {
        if (error) {
          return reject(error);
        }
        if (response.statusCode === 429) {
          return reject(new Error('TooManyRequests:' + Number(response.headers['retry-after']) * 1000));
        }
        if (response.statusCode !== 200) {
          return reject(new Error('NotSuccess'));
        }
        if (!response.body.ok) {
          return reject(new Error(response.body.error || 'UnknownError'));
        }
        resolve(response.body);
      });
    });
  }
}
