import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/event-bus.js';

// A valid CarControlState sample (the car.control payload).
const CONTROL = {
  carId: 0,
  up: true,
  right: false,
  down: false,
  left: false,
  reset: false,
} as const;

describe('EventBus', () => {
  it('delivers emit args to on() listeners', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on('car.control', fn);
    bus.emit('car.control', CONTROL);
    expect(fn).toHaveBeenCalledWith(CONTROL);
  });

  it('on() returns an unsubscribe that removes the listener', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('race.started', fn);
    expect(bus.listenerCount('race.started')).toBe(1);
    off();
    expect(bus.listenerCount('race.started')).toBe(0);
    bus.emit('race.started');
    expect(fn).not.toHaveBeenCalled();
  });

  it('off() removes a specific listener', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('track.beforeLoad', a);
    bus.on('track.beforeLoad', b);
    bus.off('track.beforeLoad', a);
    bus.emit('track.beforeLoad', 'summer-1');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith('summer-1');
  });

  it('once() fires only on the first emit', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.once('race.finished', fn);
    bus.emit('race.finished', 123.45);
    bus.emit('race.finished', 200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(123.45);
    expect(bus.listenerCount('race.finished')).toBe(0);
  });

  it('isolates a throwing listener from siblings and the emitter', () => {
    const errors: unknown[] = [];
    const bus = new EventBus({ onError: (e) => errors.push(e) });
    const good = vi.fn();
    bus.on('car.control', () => {
      throw new Error('boom');
    });
    bus.on('car.control', good);
    expect(() => bus.emit('car.control', CONTROL)).not.toThrow();
    expect(good).toHaveBeenCalledWith(CONTROL);
    expect(errors).toHaveLength(1);
    // The throwing listener is still subscribed (it just got skipped this emit).
    expect(bus.listenerCount('car.control')).toBe(2);
  });

  it('uses console.error as the default onError handler', () => {
    const bus = new EventBus();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.on('physics.postStep', () => {
      throw new Error('boom');
    });
    bus.emit('physics.postStep', 16);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('emit with no listeners is a no-op', () => {
    const bus = new EventBus();
    expect(() => bus.emit('render.preRender')).not.toThrow();
    expect(bus.listenerCount('render.preRender')).toBe(0);
  });

  it('removeAllListeners clears one event, then all', () => {
    const bus = new EventBus();
    bus.on('track.beforeLoad', () => {});
    bus.on('track.afterLoad', () => {});
    bus.removeAllListeners('track.beforeLoad');
    expect(bus.listenerCount('track.beforeLoad')).toBe(0);
    expect(bus.listenerCount('track.afterLoad')).toBe(1);
    bus.removeAllListeners();
    expect(bus.listenerCount('track.afterLoad')).toBe(0);
  });

  it('snapshots listeners at emit start (mid-emit unsubscribe is safe)', () => {
    const bus = new EventBus();
    const seen: number[] = [];
    let unsubscribeSecond: () => void;
    bus.on('checkpoint.passed', () => {
      seen.push(1);
      unsubscribeSecond(); // remove the next listener during this emit
    });
    unsubscribeSecond = bus.on('checkpoint.passed', () => seen.push(2));

    bus.emit('checkpoint.passed', 0);
    // The snapshot still contained the second listener, so it ran this round.
    expect(seen).toEqual([1, 2]);

    bus.emit('checkpoint.passed', 0);
    // On the next round only the first listener remains.
    expect(seen).toEqual([1, 2, 1]);
  });
});
