import { describe, expect, it } from 'vitest';
import type { Mod, ResolveContext } from '../src/index.js';
import { DependencyError, resolveDependencies } from '../src/index.js';

/** Build a Mod with sensible defaults; only `id` is required. */
function mod(overrides: Partial<Mod> & { id: string }): Mod {
  return {
    version: '1.0.0',
    priority: 0,
    environment: '*',
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

// #6: Fabric-accurate soft-disable. `breaks` used to throw and abort the WHOLE
// load — one incompatibility declaration took every unrelated mod down with it.
// Now the DECLARING mod is disabled (excluded from `order`, reported in
// `disabled` + as a `breaks-disabled` warning) and everything else loads,
// including the broken target: `breaks` means "I can't run next to that",
// not "that may not run".
describe('resolveDependencies — breaks soft-disables the declaring mod (#6)', () => {
  it('disables the declarer, loads the target and unrelated mods', () => {
    const result = resolveDependencies([
      mod({ id: 'x', breaks: { y: '*' } }),
      mod({ id: 'y', version: '1.0.0' }),
      mod({ id: 'bystander' }),
    ]);
    expect(ids(result.order).sort()).toEqual(['bystander', 'y']);
    expect(result.disabled).toEqual([
      {
        id: 'x',
        reason:
          "mod 'x' declares 'breaks' on 'y@*' but 'y@1.0.0' is installed — 'x' is disabled; 'y' still loads",
      },
    ]);
    const w = result.warnings.find((warn) => warn.kind === 'breaks-disabled');
    expect(w).toMatchObject({ mod: 'x', other: 'y' });
    // The message must say who is disabled and who still loads — "breaks"
    // alone reads as if the TARGET were the one being stopped.
    expect(w?.message).toMatch(/'x' is disabled/);
    expect(w?.message).toMatch(/'y' still loads/);
  });

  it('does not disable when the target is present at a non-matching version', () => {
    const result = resolveDependencies([
      mod({ id: 'x', breaks: { y: '^2.0.0' } }),
      mod({ id: 'y', version: '1.0.0' }),
    ]);
    expect(ids(result.order).sort()).toEqual(['x', 'y']);
    expect(result.disabled).toEqual([]);
  });

  it('does not disable when the target is not installed at all', () => {
    const result = resolveDependencies([mod({ id: 'x', breaks: { y: '*' } })]);
    expect(ids(result.order)).toEqual(['x']);
    expect(result.disabled).toEqual([]);
  });

  it('matches breaks against a special ambient id (polytrack)', () => {
    const result = resolveDependencies(
      [mod({ id: 'x', breaks: { polytrack: '0.6.2' } }), mod({ id: 'other' })],
      { polytrackVersion: '0.6.2' },
    );
    expect(ids(result.order)).toEqual(['other']);
    expect(result.disabled.map((d) => d.id)).toEqual(['x']);
  });

  it('disables once (one warning) when multiple breaks entries match', () => {
    const result = resolveDependencies([
      mod({ id: 'x', breaks: { y: '*', z: '*' } }),
      mod({ id: 'y' }),
      mod({ id: 'z' }),
    ]);
    expect(result.disabled.map((d) => d.id)).toEqual(['x']);
    expect(result.warnings.filter((w) => w.kind === 'breaks-disabled')).toHaveLength(1);
  });

  it('cascades: a mod depending on a disabled mod is disabled too, naming the chain', () => {
    const result = resolveDependencies([
      mod({ id: 'breaker', breaks: { target: '*' } }),
      mod({ id: 'target' }),
      mod({ id: 'child', depends: { breaker: '*' } }),
      mod({ id: 'grandchild', depends: { child: '*' } }),
      mod({ id: 'bystander' }),
    ]);
    expect(ids(result.order).sort()).toEqual(['bystander', 'target']);
    expect(result.disabled.map((d) => d.id)).toEqual(['breaker', 'child', 'grandchild']);
    const child = result.disabled.find((d) => d.id === 'child');
    expect(child?.reason).toBe(
      "mod 'child' is disabled because it depends on 'breaker', which is disabled",
    );
    expect(
      result.warnings.filter((w) => w.kind === 'disabled-dependency').map((w) => w.mod).sort(),
    ).toEqual(['child', 'grandchild']);
  });

  it('cascades through provides, naming the provider', () => {
    const result = resolveDependencies([
      mod({ id: 'impl', provides: ['virtual-api'], breaks: { enemy: '*' } }),
      mod({ id: 'enemy' }),
      mod({ id: 'consumer', depends: { 'virtual-api': '*' } }),
    ]);
    expect(ids(result.order)).toEqual(['enemy']);
    const consumer = result.disabled.find((d) => d.id === 'consumer');
    expect(consumer?.reason).toBe(
      "mod 'consumer' is disabled because it depends on 'virtual-api', provided by 'impl', which is disabled",
    );
  });

  it("a disabled mod's own problems cannot abort the load", () => {
    // The disabled mod has a missing dep (throws for an active mod) AND a bad
    // targets range (soft-disables, #21) — being breaks-disabled first means
    // neither fires: out of the set entirely, one reason, one warning.
    const result = resolveDependencies(
      [
        mod({
          id: 'doomed',
          breaks: { present: '*' },
          depends: { 'never-installed': '*' },
          targets: ['>=99.0.0'],
        }),
        mod({ id: 'present' }),
      ],
      { polytrackVersion: '0.6.2' },
    );
    expect(ids(result.order)).toEqual(['present']);
    expect(result.disabled.map((d) => d.id)).toEqual(['doomed']);
  });

  it('a disabled mod does not emit conflict/recommend warnings (it is not loading)', () => {
    const result = resolveDependencies([
      mod({ id: 'x', breaks: { y: '*' }, conflicts: { y: '*' }, recommends: { nice: '*' } }),
      mod({ id: 'y' }),
    ]);
    expect(result.warnings.map((w) => w.kind)).toEqual(['breaks-disabled']);
  });

  it('mutual breaks disables both — deterministic, no silent winner', () => {
    // `a breaks b, b breaks a` has two "maximal" single-survivor answers;
    // picking one would be order-dependent. One pass over the INSTALLED set
    // disables both, and the fix is explicit: remove one.
    const result = resolveDependencies([
      mod({ id: 'a', breaks: { b: '*' } }),
      mod({ id: 'b', breaks: { a: '*' } }),
      mod({ id: 'c' }),
    ]);
    expect(ids(result.order)).toEqual(['c']);
    expect(result.disabled.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('a missing dep on a mod nobody disabled still throws (unchanged)', () => {
    expect(() =>
      resolveDependencies([
        mod({ id: 'x', breaks: { y: '*' } }),
        mod({ id: 'y' }),
        mod({ id: 'needy', depends: { 'never-here': '*' } }),
      ]),
    ).toThrow("mod 'needy' depends on 'never-here' which is not installed");
  });
});

// #21: environment + targets enforcement, riding the #6 soft-disable machinery.
// Both are "wrong place / wrong version" resolution outcomes: the mod is
// excluded from `order`, reported in `disabled` + as a warning, and everything
// else loads. Neither check runs when the host doesn't state the fact.
describe('resolveDependencies — environment filtering (#21)', () => {
  it('soft-disables a mod declaring a different concrete environment', () => {
    const result = resolveDependencies(
      [mod({ id: 'desktop-only', environment: 'desktop' }), mod({ id: 'bystander' })],
      { hostEnvironment: 'web' },
    );
    expect(ids(result.order)).toEqual(['bystander']);
    const d = result.disabled.find((e) => e.id === 'desktop-only');
    expect(d?.reason).toBe(
      "mod 'desktop-only' declares environment 'desktop' but the host is 'web' — 'desktop-only' is disabled",
    );
    expect(result.warnings).toContainEqual({
      kind: 'environment-mismatch',
      mod: 'desktop-only',
      message: d?.reason,
    });
  });

  it("loads a matching or '*' mod", () => {
    const result = resolveDependencies(
      [mod({ id: 'web-mod', environment: 'web' }), mod({ id: 'anywhere', environment: '*' })],
      { hostEnvironment: 'web' },
    );
    expect(ids(result.order).sort()).toEqual(['anywhere', 'web-mod']);
    expect(result.disabled).toEqual([]);
  });

  it('does not filter when the host environment is unknown', () => {
    const result = resolveDependencies([mod({ id: 'desktop-only', environment: 'desktop' })]);
    expect(ids(result.order)).toEqual(['desktop-only']);
    expect(result.disabled).toEqual([]);
  });

  it("does not filter when the host claims '*' (treated as unstated)", () => {
    const result = resolveDependencies(
      [mod({ id: 'desktop-only', environment: 'desktop' })],
      { hostEnvironment: '*' },
    );
    expect(ids(result.order)).toEqual(['desktop-only']);
    expect(result.disabled).toEqual([]);
  });

  it('cascades: a mod depending on an environment-disabled mod is disabled too', () => {
    const result = resolveDependencies(
      [
        mod({ id: 'worker-lib', environment: 'worker' }),
        mod({ id: 'consumer', depends: { 'worker-lib': '*' } }),
      ],
      { hostEnvironment: 'web' },
    );
    expect(ids(result.order)).toEqual([]);
    expect(result.disabled.map((d) => d.id)).toEqual(['consumer', 'worker-lib']);
    expect(result.disabled.find((d) => d.id === 'consumer')?.reason).toBe(
      "mod 'consumer' is disabled because it depends on 'worker-lib', which is disabled",
    );
  });

  it('a breaks-disabled mod keeps its breaks reason (first matching reason wins)', () => {
    const result = resolveDependencies(
      [mod({ id: 'x', environment: 'desktop', breaks: { y: '*' } }), mod({ id: 'y' })],
      { hostEnvironment: 'web' },
    );
    expect(result.disabled.find((d) => d.id === 'x')?.reason).toMatch(/breaks/);
    expect(result.warnings.filter((w) => w.mod === 'x')).toHaveLength(1);
  });
});

describe('resolveDependencies — targets soft-disable (#21)', () => {
  it('does not check targets when the game version is unknown', () => {
    const result = resolveDependencies([mod({ id: 'x', targets: ['>=0.7.0'] })]);
    expect(ids(result.order)).toEqual(['x']);
    expect(result.disabled).toEqual([]);
  });

  it('empty targets means no constraint', () => {
    const result = resolveDependencies([mod({ id: 'x', targets: [] })], {
      polytrackVersion: '0.6.2',
    });
    expect(ids(result.order)).toEqual(['x']);
  });

  it('any one matching range keeps the mod active (ranges OR together)', () => {
    const result = resolveDependencies(
      [mod({ id: 'x', targets: ['>=0.7.0', '0.6.x'] })],
      { polytrackVersion: '0.6.2' },
    );
    expect(ids(result.order)).toEqual(['x']);
    expect(result.disabled).toEqual([]);
  });

  it('cascades: a mod depending on a stale-targets mod is disabled too', () => {
    const result = resolveDependencies(
      [
        mod({ id: 'stale', targets: ['<0.6.0'] }),
        mod({ id: 'consumer', depends: { stale: '*' } }),
        mod({ id: 'bystander' }),
      ],
      { polytrackVersion: '0.6.2' },
    );
    expect(ids(result.order)).toEqual(['bystander']);
    expect(result.disabled.map((d) => d.id)).toEqual(['consumer', 'stale']);
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

  it('soft-disables a mod that does not target the running game version (#21)', () => {
    // This used to hard-throw and abort the WHOLE load — one stale mod took
    // every unrelated mod down, the failure mode #6 removed for `breaks`.
    const result = resolveDependencies(
      [mod({ id: 'x', targets: ['>=0.7.0'] }), mod({ id: 'bystander' })],
      { polytrackVersion: '0.6.2' },
    );
    expect(ids(result.order)).toEqual(['bystander']);
    const d = result.disabled.find((e) => e.id === 'x');
    expect(d?.reason).toBe(
      "mod 'x' targets '>=0.7.0' but polytrack is 0.6.2 — 'x' is disabled",
    );
    expect(result.warnings).toContainEqual({
      kind: 'incompatible-target',
      mod: 'x',
      other: 'polytrack',
      message: d?.reason,
    });
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
