import { describe, expect, it } from 'vitest';
import type { Mod, ResolveContext } from '../src/index.js';
import { DependencyError, resolveDependencies } from '../src/index.js';

/** Build a Mod with sensible defaults; only `id` is required. */
function mod(overrides: Partial<Mod> & { id: string }): Mod {
  return {
    version: '1.0.0',
    priority: 0,
    targets: [],
    depends: {},
    recommends: {},
    suggests: {},
    conflicts: {},
    breaks: {},
    includes: {},
    provides: [],
    ...overrides,
  };
}

const ids = (mods: Mod[]): string[] => mods.map((m) => m.id);

describe('resolveDependencies — topological order', () => {
  it('places dependencies before dependents', () => {
    const result = resolveDependencies([
      mod({ id: 'a', depends: { b: '*' } }),
      mod({ id: 'b' }),
    ]);
    expect(ids(result.order)).toEqual(['b', 'a']);
  });

  it('handles a diamond dependency', () => {
    const result = resolveDependencies([
      mod({ id: 'app', depends: { a: '*', b: '*' } }),
      mod({ id: 'a', depends: { core: '*' } }),
      mod({ id: 'b', depends: { core: '*' } }),
      mod({ id: 'core' }),
    ]);
    const order = ids(result.order);
    expect(order.indexOf('core')).toBeLessThan(order.indexOf('a'));
    expect(order.indexOf('core')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('app'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('app'));
    expect(order).toHaveLength(4);
  });
});

describe('resolveDependencies — cycle detection', () => {
  it('throws an error naming the exact cycle', () => {
    expect(() =>
      resolveDependencies([
        mod({ id: 'a', depends: { b: '*' } }),
        mod({ id: 'b', depends: { a: '*' } }),
      ]),
    ).toThrow(DependencyError);

    expect(() =>
      resolveDependencies([
        mod({ id: 'a', depends: { b: '*' } }),
        mod({ id: 'b', depends: { a: '*' } }),
      ]),
    ).toThrow('dependency cycle: a -> b -> a');
  });

  it('reports a longer cycle', () => {
    expect(() =>
      resolveDependencies([
        mod({ id: 'a', depends: { c: '*' } }),
        mod({ id: 'b', depends: { a: '*' } }),
        mod({ id: 'c', depends: { b: '*' } }),
      ]),
    ).toThrow('dependency cycle: a -> c -> b -> a');
  });
});

describe('resolveDependencies — missing dependency', () => {
  it('throws an error naming the missing dep', () => {
    expect(() =>
      resolveDependencies([mod({ id: 'x', depends: { y: '*' } })]),
    ).toThrow("mod 'x' depends on 'y' which is not installed");
  });
});

describe('resolveDependencies — version conflict', () => {
  it('throws naming the installed version and the incompatible range/mod', () => {
    expect(() =>
      resolveDependencies([
        mod({ id: 'lib', version: '1.0.0' }),
        mod({ id: 'a', depends: { lib: '^1.0.0' } }),
        mod({ id: 'b', depends: { lib: '^2.0.0' } }),
      ]),
    ).toThrow(
      "version conflict: 'lib' is installed at 1.0.0 but incompatible with '^2.0.0' required by 'b'",
    );
  });
});

describe('resolveDependencies — breaks', () => {
  it('refuses (throws) when a broken target is present at a matching version', () => {
    expect(() =>
      resolveDependencies([
        mod({ id: 'x', breaks: { y: '*' } }),
        mod({ id: 'y', version: '1.0.0' }),
      ]),
    ).toThrow(
      "mod 'x' declares 'breaks' on 'y@*' but 'y@1.0.0' is installed",
    );
  });

  it('does not break when the target is present at a non-matching version', () => {
    expect(() =>
      resolveDependencies([
        mod({ id: 'x', breaks: { y: '^2.0.0' } }),
        mod({ id: 'y', version: '1.0.0' }),
      ]),
    ).not.toThrow();
  });
});

describe('resolveDependencies — conflicts (warning, non-blocking)', () => {
  it('records a warning and still resolves', () => {
    const result = resolveDependencies([
      mod({ id: 'a', conflicts: { b: '*' } }),
      mod({ id: 'b', version: '1.0.0' }),
    ]);
    expect(ids(result.order)).toEqual(['a', 'b']);
    expect(result.warnings).toContainEqual({
      kind: 'conflict',
      mod: 'a',
      other: 'b',
      message: "mod 'a' conflicts with 'b@1.0.0' (both will load)",
    });
  });
});

describe('resolveDependencies — priority tiebreak', () => {
  it('orders unrelated mods by priority desc, then id asc', () => {
    const result = resolveDependencies([
      mod({ id: 'low', priority: 0 }),
      mod({ id: 'high', priority: 5 }),
      mod({ id: 'aaa', priority: 5 }),
    ]);
    // priority 5 first (aaa before high by id), then priority 0
    expect(ids(result.order)).toEqual(['aaa', 'high', 'low']);
  });

  it('never overrides topological order', () => {
    // a depends on b; even though a has higher priority, b loads first.
    const result = resolveDependencies([
      mod({ id: 'a', priority: 10, depends: { b: '*' } }),
      mod({ id: 'b', priority: 0 }),
    ]);
    expect(ids(result.order)).toEqual(['b', 'a']);
  });
});

describe('resolveDependencies — advanced semantics', () => {
  it('resolves a dep via `provides`', () => {
    const result = resolveDependencies([
      mod({ id: 'lib-shim', provides: ['shim'] }),
      mod({ id: 'consumer', depends: { shim: '*' } }),
    ]);
    expect(ids(result.order)).toEqual(['lib-shim', 'consumer']);
  });

  it('resolves the special id `tspml-api` against the ambient api version', () => {
    const ctx: ResolveContext = { apiVersion: '1.2.0' };
    expect(() =>
      resolveDependencies(
        [mod({ id: 'a', depends: { 'tspml-api': '^1.0.0' } })],
        ctx,
      ),
    ).not.toThrow();
  });

  it('fails loudly when a mod does not target the running game version', () => {
    expect(() =>
      resolveDependencies(
        [mod({ id: 'x', targets: ['>=0.7.0'] })],
        { polytrackVersion: '0.6.2' },
      ),
    ).toThrow("mod 'x' targets '>=0.7.0' but polytrack is 0.6.2");
  });

  it('warns about a missing recommendation', () => {
    const result = resolveDependencies([
      mod({ id: 'a', recommends: { nice: '^1.0.0' } }),
    ]);
    expect(result.warnings).toContainEqual({
      kind: 'missing-recommendation',
      mod: 'a',
      other: 'nice',
      message: "mod 'a' recommends 'nice@^1.0.0' which is not installed",
    });
  });

  it('rejects duplicate mod ids', () => {
    expect(() =>
      resolveDependencies([mod({ id: 'a' }), mod({ id: 'a' })]),
    ).toThrow("duplicate mod id 'a'");
  });
});

// #16: `includes` (Fabric's JAR-in-JAR analog) was validated by manifest.ts and
// copied onto Mod, then never consulted by anything. An author could declare a
// nested mod, watch the manifest validate cleanly, watch the load succeed — and
// the nested mod simply would not be there. Silent no-ops on a documented field
// are worse than an unimplemented field, because nothing tells you.
describe('resolveDependencies — includes is not implemented (#16)', () => {
  it('warns loudly instead of silently ignoring the field', () => {
    const result = resolveDependencies([
      mod({ id: 'bundle', includes: { nested: '^1.0.0' } }),
    ]);
    const w = result.warnings.find((x) => x.kind === 'unsupported-includes');
    expect(w).toBeDefined();
    expect(w?.mod).toBe('bundle');
    expect(w?.other).toBe('nested');
    // The message has to say the nested mod will NOT load — "unsupported" alone
    // reads as "harmless", which is exactly the wrong inference.
    expect(w?.message).toMatch(/will NOT be loaded/);
    expect(w?.message).toMatch(/depends/); // points at the workaround
  });

  it('still loads the declaring mod — the warning is not fatal', () => {
    const result = resolveDependencies([
      mod({ id: 'bundle', includes: { nested: '*' } }),
      mod({ id: 'other' }),
    ]);
    // Rejecting would break a manifest that is valid per the published spec.
    expect(ids(result.order).sort()).toEqual(['bundle', 'other']);
  });

  it('warns once per included id', () => {
    const result = resolveDependencies([
      mod({ id: 'bundle', includes: { one: '*', two: '*' } }),
    ]);
    const w = result.warnings.filter((x) => x.kind === 'unsupported-includes');
    expect(w.map((x) => x.other).sort()).toEqual(['one', 'two']);
  });

  it('says nothing when no mod declares includes', () => {
    const result = resolveDependencies([mod({ id: 'plain' })]);
    expect(result.warnings.filter((x) => x.kind === 'unsupported-includes')).toEqual([]);
  });
});
