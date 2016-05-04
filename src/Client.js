import request from 'request';
import {Observable} from '@reactivex/rxjs';

export default class Client {
  constructor({token, timeout = 10000}) {
    if (!token) {
      throw new Error('NoToken');
    }
    this.token = token;
    this.timeout = timeout;
  }

  callApi(method = 'api.test', params = {}) {
    return Observable.create(observer => {
      params.token = params.token || this.token;
      request({
        uri: `https://slack.com/api/${method}`,
        qs: params,
        json: true,
        timeout: this.timeout
      }, (error, response) => {
        if (error) {
          return observer.error(error);
        }
        if (response.statusCode === 429) {
          const error = new Error('TooManyRequests');
          error.delay = Number(response.headers['retry-after']) * 1000;
          return observer.error(error);
        }
        if (response.statusCode !== 200) {
          return observer.error(new Error('NotSuccess'));
        }
        if (!response.body.ok) {
          return observer.error(new Error(response.body.error || 'UnknownError'));
        }
        observer.next(response.body);
        observer.complete();
      });
    }).share();
  }
}
