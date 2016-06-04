'use strict';

import {Observable} from 'rxjs/Observable';
import {of} from 'rxjs/observable/of';
import {fromEvent} from 'rxjs/observable/fromEvent';
import {interval} from 'rxjs/observable/interval';
import {range} from 'rxjs/observable/range';
import {empty} from 'rxjs/observable/empty';
import {zip} from 'rxjs/observable/zip';
import {filter} from 'rxjs/operator/filter';
import {share} from 'rxjs/operator/share';
import {repeat} from 'rxjs/operator/repeat';
import {retry} from 'rxjs/operator/retry';
import {takeUntil} from 'rxjs/operator/takeUntil';
import {take} from 'rxjs/operator/take';
import {timestamp} from 'rxjs/operator/timestamp';
import {merge} from 'rxjs/operator/merge';
import {mergeMap} from 'rxjs/operator/mergeMap';
import {withLatestFrom} from 'rxjs/operator/withLatestFrom';
import {retryWhen} from 'rxjs/operator/retryWhen';
import {map} from 'rxjs/operator/map';
import {async} from 'rxjs/Scheduler/async';
import WebSocket from 'ws';
import ms from 'ms';

import {generatorScan} from './operator/generatorScan';
import {Client} from './Client';
import {match} from './util/match';

export class Bot extends Client {
  constructor({token, pingInterval = ms('10s'), pingRetryLimit = 2, timeout}) {
    super({token, timeout});

    const statusStream = this.getStatus();
    this.socketStream = this.openSocket(statusStream);
    this.eventStream = this.getEventStream(this.socketStream);
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

  createFilter(options) {
    return ({type, edited, subtype, channel, reply_to: replyTo}) => {
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
    const stream = this.eventStream::filter(this.createFilter(options));

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
    const messageStream = this.eventStream::filter(this.createFilter(options));
    messageStream
      ::generatorScan(function * (message) {
        const iterator = generator(message);
        let {value, done} = iterator.next();
        while (!done) {
          const result = iterator.next(yield match(value, observable => {
            switch (typeof observable) {
              case 'string':
                return of(observable);
              case 'number':
                return of(`${observable}`);
              case 'object':
                return observable;
              default:
                return empty();
            }
          }));
          value = result.value;
          done = result.done;
        }
      }, 1)
      ::withLatestFrom(this.socketStream, ({inner, outer}, socket) => ({reply: inner, message: outer, socket}))
      .subscribe(({reply, message, socket}) => {
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
   * @returns {Observable<Status>}
   */
  getStatus() {
    /* eslint camelcase: ["error", {properties: "never"}] */
    return this.callApi('rtm.start', {simple_latest: true, no_unreads: true})
      ::retryWhen(errorStream =>
        zip(errorStream, range(0, Infinity, async))
          ::mergeMap(([error, retry]) => {
            if (error.message === 'TooManyRequests') {
              return of(error).delay(error.delay);
            }

            if (error.message === 'invalid_auth') {
              return of(error).delay(ms('1h'));
            }

            return of(error).delay(retry * 1000);
          }))
      ::share();
  }
  /**
   *
   * @returns {Observable<WebSocket>}
   */
  openSocket(statusStream) {
    return statusStream
      ::mergeMap(status => new Observable(observer => {
        const socket = new WebSocket(status.url);
        const openStream = fromEvent(socket, 'open')::take(1);
        const closeStream = fromEvent(socket, 'close')::take(1);
        const pingStream = openStream
          ::mergeMap(() => of(0)::merge(interval(this.pingInterval)))
          ::timestamp()
          ::share();

        const pongStream = fromEvent(socket, 'pong')::timestamp();

        pingStream
          ::withLatestFrom(pongStream, (ping, pong) => ping.timestamp - pong.timestamp)
          ::filter(diff => diff > this.pingInterval * (this.pingRetryLimit - 0.5))
          ::takeUntil(closeStream)
          .subscribe(::socket.terminate);

        pingStream
          ::takeUntil(closeStream)
          .subscribe(() => socket.ping(null, {}, true));
        socket
          .on('open', () => observer.next(socket))
          .on('ping', ::socket.pong)
          .on('error', ::observer.error)
          .on('close', ::observer.complete);
        return ::socket.close;
      }))
      ::retry()
      ::repeat()
      ::share();
  }

  getEventStream(socketStream) {
    return socketStream
      ::mergeMap(socket => fromEvent(socket, 'message'))
      ::map(JSON.parse)
      ::share();
  }
}
