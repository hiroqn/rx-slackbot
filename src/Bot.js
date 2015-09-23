import Rx from 'rx';
import WebSocket from 'ws';

import Client from './Client';

export default class Bot extends Rx.Subject {
  constructor({ token, reconnectTimeout = 5000, isBuffered = true }) {
    super();
    if (!token) {
      throw new Error('NoToken');
    }
    this.token = token;
    this.id = '';
    this.name = '';
    this.channels = [];
    this.groups = [];
    this.ims = [];
    this.users = [];
    this.timeout = reconnectTimeout;
    this.client = new Client({ token });
    this.socket = { send() {} };
    this.pauser = new Rx.Subject();
    this.queue = new Rx.Subject();
    let count = 0;
    let messageQueue;
    if (isBuffered) {
      messageQueue = this.queue.pausableBuffered(this.pauser);
    } else {
      messageQueue = this.queue.pausable(this.pauser);
    }
    messageQueue.subscribe(({type, channel, text}) => {
      this.socket.send(JSON.stringify({ type, text, channel, id: count++ }));
    });
    this.pauser.onNext(false);
    this.message = this
      .filter(e => e.type === 'message' && !e.subtype && !e.edited)
      .map((event) => {
        event.rawText = event.text;
        event.text = event.text
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');
        return event;
      });
    this.connect();
  }

  send(channel, text) {
    this.queue.onNext({ channel, text, type: 'message' });
  }

  parse(data) {
    this.id = data.self.id;
    this.name = data.self.name;
    this.channels = data.channels;
    this.groups = data.groups;
    this.ims = data.ims;
    this.users = data.users;
  }

  connect() {
    return this.client.callApi('rtm.start').then(result => {
      this.parse(result);
      this.socket = new WebSocket(result.url);
      this.socket
        .on('open', () => this.pauser.onNext(true))
        .on('message', (str) => this.onNext(JSON.parse(str)))
        .on('close', () => {
          this.pauser.onNext(false);
          this.connect();
        })
        .on('error', () => this.connect());
    }, err => {
      if (this.timeout === Infinity) {
        return;
      }
      if (err.message && err.message.startWith('TooManyRequests')) {
        const [, timeout] = err.message.split(':');
        setTimeout(() => this.connect(), Number(timeout) || 0);
      } else {
        setTimeout(() => this.connect(), this.timeout);
      }
    });
  }
}
