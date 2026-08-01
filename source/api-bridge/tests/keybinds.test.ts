import { describe, expect, it, vi } from 'vitest';
import { Keybinds } from '../src/keybinds.js';

// A minimal mock of `window` for the node test environment: captures listeners
// and lets tests dispatch synthetic keyboard events.
interface MockEvent {
  code: string;
  repeat: boolean;
  preventedDefault: boolean;
}
function mockWindow() {
  const listeners: Record<string, Array<(e: MockEvent) => void>> = {};
  const win = {
    addEventListener(type: string, l: (e: MockEvent) => void) {
      (listeners[type] ??= []).push(l);
    },
    removeEventListener(type: string, l: (e: MockEvent) => void) {
      listeners[type] = (listeners[type] ?? []).filter((x) => x !== l);
    },
    dispatch(type: string, code: string, opts: { repeat?: boolean } = {}) {
      const e: MockEvent = { code, repeat: opts.repeat ?? false, preventedDefault: false };
      (listeners[type] ?? []).forEach((l) =>
        l({ ...e, preventDefault: () => { e.preventedDefault = true; } } as unknown as MockEvent & { preventDefault: () => void }),
      );
      return e;
    },
  };
  return win;
}

describe('Keybinds', () => {
  it('fires onDown on keydown and onUp on keyup for the matching key', () => {
    const win = mockWindow();
    const kb = new Keybinds(win as unknown as Window);
    const down = vi.fn();
    const up = vi.fn();
    kb.register({ id: 'm1', key: 'KeyF', onDown: down, onUp: up });

    win.dispatch('keydown', 'KeyF');
    win.dispatch('keyup', 'KeyF');
    expect(down).toHaveBeenCalledTimes(1);
    expect(up).toHaveBeenCalledTimes(1);
    kb.dispose();
  });

  it('ignores non-matching keys', () => {
    const win = mockWindow();
    const kb = new Keybinds(win as unknown as Window);
    const down = vi.fn();
    kb.register({ id: 'm1', key: 'KeyF', onDown: down });
    win.dispatch('keydown', 'KeyA');
    expect(down).not.toHaveBeenCalled();
    kb.dispose();
  });

  it('register() returns an unsubscribe; unregister stops further fires', () => {
    const win = mockWindow();
    const kb = new Keybinds(win as unknown as Window);
    const down = vi.fn();
    const off = kb.register({ id: 'm1', key: 'KeyF', onDown: down });
    win.dispatch('keydown', 'KeyF');
    off();
    win.dispatch('keydown', 'KeyF');
    expect(down).toHaveBeenCalledTimes(1);
    expect(kb.size).toBe(0);
    kb.dispose();
  });

  it('isolates a throwing handler from siblings', () => {
    const errors: unknown[] = [];
    const win = mockWindow();
    const kb = new Keybinds(win as unknown as Window, { onError: (e) => errors.push(e) });
    const good = vi.fn();
    kb.register({ id: 'bad', key: 'KeyF', onDown: () => { throw new Error('boom'); } });
    kb.register({ id: 'good', key: 'KeyF', onDown: good });
    win.dispatch('keydown', 'KeyF');
    expect(good).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
    kb.dispose();
  });

  it('dispose detaches listeners (no further dispatch)', () => {
    const win = mockWindow();
    const kb = new Keybinds(win as unknown as Window);
    const down = vi.fn();
    kb.register({ id: 'm1', key: 'KeyF', onDown: down });
    kb.dispose();
    win.dispatch('keydown', 'KeyF');
    expect(down).not.toHaveBeenCalled();
  });

  it('ignores keydown auto-repeat by default (edge-triggered)', () => {
    const win = mockWindow();
    const kb = new Keybinds(win as unknown as Window);
    const down = vi.fn();
    kb.register({ id: 'm1', key: 'KeyF', onDown: down });

    win.dispatch('keydown', 'KeyF');
    win.dispatch('keydown', 'KeyF', { repeat: true });
    win.dispatch('keydown', 'KeyF', { repeat: true });
    expect(down).toHaveBeenCalledTimes(1);
    kb.dispose();
  });

  it('fires onDown on auto-repeat when allowRepeat is true', () => {
    const win = mockWindow();
    const kb = new Keybinds(win as unknown as Window);
    const down = vi.fn();
    kb.register({ id: 'm1', key: 'KeyF', onDown: down, allowRepeat: true });

    win.dispatch('keydown', 'KeyF');
    win.dispatch('keydown', 'KeyF', { repeat: true });
    expect(down).toHaveBeenCalledTimes(2);
    kb.dispose();
  });
});
