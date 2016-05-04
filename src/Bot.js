'use strict';

import {Subject, Observable, Scheduler} from '@reactivex/rxjs';
import WebSocket from 'ws';

import Client from './Client';
import sleep from './util/sleep';

export default class Bot extends Client {
  constructor({ token }) {
    super({token});
    this._stream = this.connect();
    this.count = 0;
  }

  createFilterFunction(options) {
    return ({message: {type, edited, subtype}}) => {
      if (options.generator && type === 'hello') {
        return true;
      }

      if (type !== 'message' || edited) {
        return false;
      }

      if (options.subtype && options.subtype !== subtype) {
        return false;
      }

      if (!options.subtype && subtype) {
        return false;
      }

      return true;
    }
  }

  hear(options) {
    const stream = this._stream
      .filter(this.createFilterFunction(options));

    if (options.generator) {
      stream
        .mergeScan(({iterator}, {message, socket}) => {
          const {value = Observable.empty(), done} = iterator.next(message);
          const stream = value.share();
          return stream
            .merge(stream.isEmpty().filter(x => x).mapTo(null))
            .map(reply => ({reply, iterator, done, message, socket}));
        }, {
          done: false,
          get iterator() {
            return options.generator();
          }
        }, 1)
        .filter(({reply}) => Boolean(reply))
        .takeWhile(({done}) => !done)
        .subscribe(({message, socket, reply}) => {
          const replyJSON = JSON.stringify({
            id: this.count++,
            type: 'message',
            channel: message.channel,
            text: `${reply}`
          });

          socket.send(replyJSON)
        });
      return this;
    }

    if (options.next) {
      stream.subscribe(options);
      return this
    }
    return this;
  }

  connect() {
    return this.callApi('rtm.start', {simple_latest: true, no_unreads: true})
      .retryWhen(errorStream => errorStream
        .zip(Observable.range(0, Infinity, Scheduler.async))
        .flatMap(([error, retry]) => {
          if (error.message === 'TooManyRequests') {
            return Observable.of(error).delay(error.delay);
          } else {
            return Observable.of(error).delay(retry * 1000);
          }
        }))
      .flatMap(status =>
        new Observable(observer => {
          const socket = new WebSocket(status.url);
          const openStream = Observable.fromEvent(socket, 'open');
          const openTimeStream = openStream.map(() => Date.now()).take(1);
          const closeStream = Observable.fromEvent(socket, 'close');
          const pingStream = openStream
            .flatMap(() => Observable.interval(10 * 1000))
            .map(() => Date.now())
            .merge(openTimeStream)
            .share();

          Observable
            .fromEvent(socket, 'pong')
            .map(() => Date.now())
            .merge(openTimeStream)
            .combineLatest(pingStream, (pongTime, pingTime) => ({pongTime, pingTime}))
            .map(({pongTime, pingTime}) => pongTime - pingTime)
            .filter(diff => diff < -15000)
            .takeUntil(closeStream)
            .subscribe(() =>socket.terminate());

          pingStream
            .takeUntil(closeStream)
            .subscribe(() => socket.ping(null, {}, true));

          socket
            .on('ping', (data, flags) => socket.pong())
            .on('message', str => {
              const message = JSON.parse(str);
              observer.next({message, socket});
            })
            .on('error', error => observer.error(error))
            .on('close', () => observer.complete());
          return () => socket.close();
        }))
      .retry()
      .repeat()
      .share()
  }
}
