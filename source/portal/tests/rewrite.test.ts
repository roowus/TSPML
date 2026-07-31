import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_HOST,
  isGameHost,
  rewriteGameUrl,
} from '../lib/rewrite';

const sameOrigin = { proxyBase: '', version: '0.6.2' };

describe('rewriteGameUrl — app-polytrack (default game-asset host)', () => {
  it('rewrites a versioned asset, stripping the version into the query', () => {
    expect(
      rewriteGameUrl('https://app-polytrack.kodub.com/0.6.2/main.bundle.js', sameOrigin),
    ).toBe('/api/proxy/main.bundle.js?version=0.6.2');
  });

  it('rewrites nested code-split chunk paths', () => {
    expect(
      rewriteGameUrl('https://app-polytrack.kodub.com/0.6.2/chunks/57.bundle.js', sameOrigin),
    ).toBe('/api/proxy/chunks/57.bundle.js?version=0.6.2');
  });

  it('rewrites the version root (directory index)', () => {
    expect(
      rewriteGameUrl('https://app-polytrack.kodub.com/0.6.2/', sameOrigin),
    ).toBe('/api/proxy/?version=0.6.2');
    expect(
      rewriteGameUrl('https://app-polytrack.kodub.com/0.6.2', sameOrigin),
    ).toBe('/api/proxy/?version=0.6.2');
  });

  it('also rewrites WASM / worker assets', () => {
    expect(
      rewriteGameUrl('https://app-polytrack.kodub.com/0.6.2/polytrack_physics.wasm', sameOrigin),
    ).toBe('/api/proxy/polytrack_physics.wasm?version=0.6.2');
  });

  it('uses the path version segment when present, overriding the option', () => {
    expect(
      rewriteGameUrl('https://app-polytrack.kodub.com/0.6.1/index.html', {
        proxyBase: '',
        version: '0.6.2',
      }),
    ).toBe('/api/proxy/index.html?version=0.6.1');
  });

  it('does NOT add a host param for the default game-asset host', () => {
    const out = rewriteGameUrl(
      'https://app-polytrack.kodub.com/0.6.2/main.bundle.js',
      sameOrigin,
    );
    expect(out).not.toContain('host=');
  });
});

describe('rewriteGameUrl — other kodub hosts', () => {
  it('adds a host param and omits the version prefix from the path', () => {
    expect(
      rewriteGameUrl('https://kodub.com/api/leaderboard?track=nurburgring', sameOrigin),
    ).toBe('/api/proxy/api/leaderboard?track=nurburgring&version=0.6.2&host=kodub.com');
  });

  it('preserves multiple existing query params, then appends version + host', () => {
    const out = rewriteGameUrl('https://kodub.com/api/r?a=1&b=2', sameOrigin)!;
    expect(out).toBe('/api/proxy/api/r?a=1&b=2&version=0.6.2&host=kodub.com');
  });

  it('matches arbitrary kodub subdomains', () => {
    const out = rewriteGameUrl('https://api.kodub.com/v1/session', sameOrigin)!;
    expect(out).toBe('/api/proxy/v1/session?version=0.6.2&host=api.kodub.com');
  });
});

describe('rewriteGameUrl — proxyBase', () => {
  it('prepends an absolute origin and strips a trailing slash', () => {
    expect(
      rewriteGameUrl('https://app-polytrack.kodub.com/0.6.2/main.bundle.js', {
        proxyBase: 'https://tspml.vercel.app/',
        version: '0.6.2',
      }),
    ).toBe('https://tspml.vercel.app/api/proxy/main.bundle.js?version=0.6.2');
  });

  it('uses an empty proxyBase for a same-origin relative URL', () => {
    const out = rewriteGameUrl('https://app-polytrack.kodub.com/0.6.2/x.js', {
      proxyBase: '',
      version: '0.6.2',
    });
    expect(out?.startsWith('/api/proxy/')).toBe(true);
  });
});

describe('rewriteGameUrl — non-game URLs return null', () => {
  it('rejects unrelated hosts', () => {
    expect(rewriteGameUrl('https://example.com/0.6.2/main.bundle.js', sameOrigin)).toBeNull();
    expect(rewriteGameUrl('https://webgamer.io/polytrack', sameOrigin)).toBeNull();
    expect(rewriteGameUrl('https://kongregate.com/', sameOrigin)).toBeNull();
  });

  it('rejects kodub look-alikes (suffix / prefix tricks)', () => {
    expect(rewriteGameUrl('https://notkodub.com/0.6.2/main.bundle.js', sameOrigin)).toBeNull();
    expect(rewriteGameUrl('https://kodub.com.evil.com/x', sameOrigin)).toBeNull();
  });

  it('rejects non-http(s) protocols', () => {
    expect(rewriteGameUrl('data:text/plain,hello', sameOrigin)).toBeNull();
    expect(rewriteGameUrl('blob:https://app-polytrack.kodub.com/abc', sameOrigin)).toBeNull();
    expect(rewriteGameUrl('javascript:void(0)', sameOrigin)).toBeNull();
    expect(rewriteGameUrl('ws://app-polytrack.kodub.com/socket', sameOrigin)).toBeNull();
  });

  it('rejects invalid / empty input', () => {
    expect(rewriteGameUrl('not a url', sameOrigin)).toBeNull();
    expect(rewriteGameUrl('', sameOrigin)).toBeNull();
    expect(rewriteGameUrl('///0.6.2/x', sameOrigin)).toBeNull();
  });
});

describe('isGameHost', () => {
  it('matches kodub.com and subdomains', () => {
    expect(isGameHost('kodub.com')).toBe(true);
    expect(isGameHost('app-polytrack.kodub.com')).toBe(true);
    expect(isGameHost(DEFAULT_GAME_HOST)).toBe(true);
    expect(isGameHost('app-polytrack-desktop.kodub.com')).toBe(true);
    expect(isGameHost('api.kodub.com')).toBe(true);
  });

  it('rejects non-kodub and spoofed hosts', () => {
    expect(isGameHost('example.com')).toBe(false);
    expect(isGameHost('kodub.com.evil.com')).toBe(false);
    expect(isGameHost('notkodub.com')).toBe(false);
    expect(isGameHost('')).toBe(false);
  });
});
