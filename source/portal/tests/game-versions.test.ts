/**
 * The selectable-version set (lib/game-versions.ts).
 *
 * Small module, but the thing worth pinning is the POLICY, not the data: a
 * version with no symbol map must be visible-and-disabled with a reason, never
 * quietly selectable. A picker that let you choose 0.6.0 today would hand you a
 * vanilla game with every mod silently inert — strictly worse than an option you
 * cannot click.
 *
 * `resolveGameVersion` is deliberately a READ-side check. If it were applied on
 * write, an instance created while 0.6.0 was unavailable would stay pinned to the
 * fallback forever; validating on read means it starts working the day its map
 * ships.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_VERSION,
  GAME_VERSIONS,
  isSelectableGameVersion,
  resolveGameVersion,
  VERSION_PICKER_NOTE,
} from '@/lib/game-versions';

describe('GAME_VERSIONS', () => {
  it('offers exactly one selectable build today, and it is the default', () => {
    // `source/mappings/maps/` holds one file, `polytrack-0.6.2.json`. If a second
    // map lands, this test is the reminder that three other places hardcode the
    // version too (see the module header) — the list is not the whole change.
    const selectable = GAME_VERSIONS.filter((v) => v.selectable).map((v) => v.id);
    expect(selectable).toEqual(['0.6.2']);
    expect(DEFAULT_GAME_VERSION).toBe('0.6.2');
    expect(isSelectableGameVersion(DEFAULT_GAME_VERSION)).toBe(true);
  });

  it('gives every non-selectable build a reason, and selectable ones none', () => {
    for (const v of GAME_VERSIONS) {
      if (v.selectable) expect(v.reason).toBe('');
      else expect(v.reason.length).toBeGreaterThan(0);
    }
  });

  it('lists 0.6.0 as visible-and-disabled rather than omitting it', () => {
    // Omitting it would be the easy option and the dishonest one: the build
    // exists, players are on it, and "not in the list" reads as "not a thing"
    // rather than "we cannot mod it yet".
    const v060 = GAME_VERSIONS.find((v) => v.id === '0.6.0');
    expect(v060).toBeDefined();
    expect(v060?.selectable).toBe(false);
    expect(isSelectableGameVersion('0.6.0')).toBe(false);
  });
});

describe('resolveGameVersion', () => {
  it('keeps a selectable id', () => {
    expect(resolveGameVersion('0.6.2')).toBe('0.6.2');
  });

  it('falls back for unselectable, unknown, and non-string ids', () => {
    expect(resolveGameVersion('0.6.0')).toBe(DEFAULT_GAME_VERSION);
    expect(resolveGameVersion('9.9.9')).toBe(DEFAULT_GAME_VERSION);
    expect(resolveGameVersion(undefined)).toBe(DEFAULT_GAME_VERSION);
    expect(resolveGameVersion(null)).toBe(DEFAULT_GAME_VERSION);
    expect(resolveGameVersion(42)).toBe(DEFAULT_GAME_VERSION);
    expect(resolveGameVersion({ id: '0.6.2' })).toBe(DEFAULT_GAME_VERSION);
  });
});

describe('VERSION_PICKER_NOTE', () => {
  it('explains the failure mode, not just the absence of a map', () => {
    // "there is no map" invites "so what?". The note has to say what actually
    // happens to the player, which is that their mods do nothing.
    expect(VERSION_PICKER_NOTE).toMatch(/vanilla/i);
    expect(VERSION_PICKER_NOTE).toMatch(/0\.6\.2/);
  });
});
