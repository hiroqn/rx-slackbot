import {errorObject} from 'rxjs/util/errorObject';
import {subscribeToResult} from 'rxjs/util/subscribeToResult';
import {OuterSubscriber} from 'rxjs/OuterSubscriber';

export class GeneratorScanSubscriber extends OuterSubscriber {
  constructor(destination, generator, concurrent) {
    super(destination);
    this.generator = generator;
    this.iterator = null;
    this.concurrent = concurrent;
    this.hasCompleted = false;
    this.buffer = [];
    this.active = 0;
    this.index = 0;
  }

  _next(nextValue) {
    if (this.active < this.concurrent) {
      const index = this.index;
      this.index += 1;
      const {value, done} = (value => {
        try {
          if (this.iterator) {
            return this.iterator.next(value);
          }
          this.iterator = this.generator(value);
          return this.iterator.next();
        } catch (error) {
          errorObject.e = error;
          return {value: errorObject, done: true};
        }
      })(nextValue);

      const {destination} = this;

      if (value === errorObject) {
        destination.error(errorObject.e);
      } else if (done) {
        destination.complete();
      } else {
        this.active += 1;
        this._innerSub(value, nextValue, index);
      }
    } else {
      this.buffer.push(nextValue);
    }
  }

  _innerSub(ish, value, index) {
    this.add(subscribeToResult(this, ish, value, index));
  }

  _complete() {
    const {destination} = this;
    this.hasCompleted = true;
    if (this.active === 0 && this.buffer.length === 0) {
      destination.complete();
    }
  }

  notifyNext(outerValue, innerValue) {
    const {destination} = this;
    destination.next({
      outer: outerValue,
      inner: innerValue
    });
  }

  notifyComplete(innerSub) {
    const buffer = this.buffer;
    this.remove(innerSub);
    this.active -= 1;
    if (buffer.length > 0) {
      this._next(buffer.shift());
    } else if (this.active === 0 && this.hasCompleted) {
      this.destination.complete();
    }
  }
}

export class GeneratorScanOperator {
  constructor(generator, concurrent) {
    this.generator = generator;
    this.concurrent = concurrent;
  }

  call(subscriber, source) {
    return source._subscribe(new GeneratorScanSubscriber(subscriber, this.generator, this.concurrent));
  }
}

/**
 * @param generator
 * @param seed
 * @param concurrent
 * @return {Observable<R>|WebSocketSubject<T>|Observable<T>}
 * @method mergeScan
 * @owner Observable
 */
export function generatorScan(generator, project, concurrent = Number.POSITIVE_INFINITY) {
  return this.lift(new GeneratorScanOperator(generator, project, concurrent));
}
