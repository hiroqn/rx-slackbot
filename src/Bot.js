'use strict';

import {Observable, Scheduler} from '@reactivex/rxjs';
import WebSocket from 'ws';
import ms from 'ms';

import Client from './Client';

export default class Bot extends Client {
  constructor({token, pingInterval = ms('10s'), pingRetryLimit = 2, timeout}) {
    super({token, timeout});
    this._stream = this.connect();
    this.pingInterval = pingInterval;
    this.pingRetryLimit = pingRetryLimit;
    this.counter = (function * () {
      let i = 0;
      while (i >= 0) {
        yield i;
        i += 1;
      }
    })();
  }

  createFilterFunction(options) {
    return ({message: {type, edited, subtype, channel, reply_to: replyTo}}) => {
      if (options.generator && type === 'hello') {
        return true;
      }

      if (type !== 'message' || edited || replyTo) {
        return false;
      }

      if (options.subtype && options.subtype !== subtype) {
        return false;
      }

      if (!options.subtype && subtype) {
        return false;
      }

      if (options.channel && channel !== options.channel) {
        return false;
      }

      return true;
    };
  }

  hear(options) {
    const stream = this._stream
      .filter(this.createFilterFunction(options));

    if (options.generator) {
      return this.hearWithGenerator(options, options.generator);
    }

    if (options.next) {
      stream.subscribe(options);
      return this;
    }
    return this;
  }

  /**
   *
   * @param options
   * @param generator
   * @returns {Bot}
   */
  hearWithGenerator(options, generator) {
    const messageStream = this._stream.filter(this.createFilterFunction(options));
    messageStream
      .do(({message}) => console.log(message))
      .mergeScan(({iterator}, {message, socket}) => {
        const {value = Observable.empty(), done} = iterator.next(message);
        const stream = (typeof value === 'object' ? value || Observable.empty() : Observable.of(`${value}`)).share();
        return stream
          .merge(stream.isEmpty().filter(x => x).mapTo(null))
          .map(reply => ({reply, iterator, done, message, socket}));
      }, {
        done: false,
        get iterator() {
          return generator();
        }
      }, 1)
      .filter(({reply}) => Boolean(reply))
      .takeWhile(({done}) => !done)
      .subscribe(({message, socket, reply}) => {
        if (typeof reply === 'string') {
          const replyJSON = JSON.stringify({
            id: this.counter.next(),
            type: 'message',
            channel: message.channel,
            text: `${reply}`
          });

          socket.send(replyJSON);
        }
      });
    return this;
  }

  /**
   *
   * @returns {Observable}
   */
  connect() {
    /* eslint camelcase: ["error", {properties: "never"}] */
    return this.callApi('rtm.start', {simple_latest: true, no_unreads: true})
      .retryWhen(errorStream => errorStream
        .zip(Observable.range(0, Infinity, Scheduler.async))
        .flatMap(([error, retry]) => {
          if (error.message === 'TooManyRequests') {
            return Observable.of(error).delay(error.delay);
          }

          if (error.message === 'invalid_auth') {
            return Observable.of(error).delay(ms('1h'));
          }

          return Observable.of(error).delay(retry * 1000);
        }))
      .flatMap(status =>
        new Observable(observer => {
          const socket = new WebSocket(status.url);
          const openStream = Observable.fromEvent(socket, 'open').take(1);
          const closeStream = Observable.fromEvent(socket, 'close').take(1);
          const pingStream = openStream
            .flatMap(() => Observable.of(0).merge(Observable.interval(this.pingInterval)))
            .timestamp()
            .share();

          const pongStream = Observable.fromEvent(socket, 'pong').timestamp();

          pingStream
            .withLatestFrom(pongStream, (ping, pong) => ping.timestamp - pong.timestamp)
            .filter(diff => diff > this.pingInterval * (this.pingRetryLimit - 0.5))
            .takeUntil(closeStream)
            .subscribe(::socket.terminate);

          pingStream
            .takeUntil(closeStream)
            .subscribe(() => socket.ping(null, {}, true));

          socket
            .on('ping', ::socket.pong)
            .on('message', str => {
              const message = JSON.parse(str);
              observer.next({message, socket, status});
            })
            .on('error', ::observer.error)
            .on('close', ::observer.complete);
          return ::socket.close;
        }))
      .retry()
      .repeat()
      .share();
  }
}
