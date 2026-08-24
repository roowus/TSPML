import { describe, expect, it } from 'vitest';
import {
  centerCropSquare,
  drawToDataUrl,
  fileToInstanceIcon,
  ICON_LIMITS,
  instanceIconFromUrl,
  instanceInitial,
  normalizeInstanceIcon,
} from '../lib/instance-icon';
import type { IconCanvasDeps } from '../lib/instance-icon';

/**
 * The instance-icon layer has one job that matters more than the rest: an
 * upload must never reach storage at its original size.
 *
 * The instance store shares a ~5 MB localStorage budget with the mod pool, and
 * `saveInstances`/`saveUserMods` both return `false` rather than throwing when
 * a write is refused — so overspending the budget is SILENT. The visible
 * symptom lands later and somewhere else entirely: a mod added afterwards that
 * quietly does not persist. That is what these tests are guarding, and it is
 * why the size ceiling is asserted after encoding rather than trusted from the
 * canvas call.
 *
 * The other half is trust. `normalizeInstanceIcon` runs during render for every
 * card on the launcher, against a store the user can hand-edit, and its output
 * goes straight into an `<img src>` — so it must never throw and must never
 * pass a scheme an `<img>` would treat as anything but an image.
 */

/** A canvas stand-in: records what it was asked to draw, returns a fixed URI. */
function fakeDeps(dataUrl: string, opts: { noContext?: boolean } = {}): {
  deps: IconCanvasDeps;
  calls: { drew: unknown[]; size: number | null; encoded: [string | undefined, number | undefined] | null };
} {
  const calls: {
    drew: unknown[];
    size: number | null;
    encoded: [string | undefined, number | undefined] | null;
  } = { drew: [], size: null, encoded: null };
  const deps: IconCanvasDeps = {
    createCanvas: (size) => {
      calls.size = size;
      return {
        getContext: () =>
          opts.noContext === true
            ? null
            : {
                clearRect: () => undefined,
                drawImage: (...args: unknown[]) => {
                  calls.drew.push(args);
                },
              },
        toDataURL: (type, quality) => {
          calls.encoded = [type, quality];
          return dataUrl;
        },
      };
    },
    decode: async () => ({ width: 4, height: 4, source: {} as CanvasImageSource }),
  };
  return { deps, calls };
}

/** A File without a DOM: only `.type`, `.size` and `.name` are ever read. */
function fakeFile(type: string, size: number, name = 'pic.png'): File {
  return { type, size, name } as unknown as File;
}

describe('normalizeInstanceIcon', () => {
  it('accepts data:image URIs, which is what the upload path produces', () => {
    expect(normalizeInstanceIcon('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA');
    // Case-insensitively: a hand-edited store is not obliged to be tidy.
    expect(normalizeInstanceIcon('DATA:IMAGE/PNG;base64,AA')).toBe('DATA:IMAGE/PNG;base64,AA');
  });

  it('accepts http(s) URLs and returns the parsed href', () => {
    expect(normalizeInstanceIcon('https://example.com/i.png')).toBe('https://example.com/i.png');
    expect(normalizeInstanceIcon('http://example.com/i.png')).toBe('http://example.com/i.png');
  });

  it('refuses non-image data URIs', () => {
    // `data:text/html` in an <img src> renders nothing, but accepting it would
    // mean the field's contract is "any data URI", which the next reader would
    // reasonably extend to a context where it does matter.
    expect(normalizeInstanceIcon('data:text/html,<b>x</b>')).toBeNull();
    expect(normalizeInstanceIcon('data:application/json,{}')).toBeNull();
  });

  it('refuses schemes that are not http(s)', () => {
    expect(normalizeInstanceIcon('javascript:alert(1)')).toBeNull();
    expect(normalizeInstanceIcon('file:///etc/passwd')).toBeNull();
    expect(normalizeInstanceIcon('blob:https://example.com/abc')).toBeNull();
  });

  it('refuses kodub hosts, which the service worker rewrites into the game proxy', () => {
    expect(normalizeInstanceIcon('https://kodub.com/i.png')).toBeNull();
    expect(normalizeInstanceIcon('https://cdn.kodub.com/i.png')).toBeNull();
    // Not a suffix trap: a host merely ENDING in the string is a different site.
    expect(normalizeInstanceIcon('https://notkodub.com/i.png')).toBe('https://notkodub.com/i.png');
  });

  it('refuses a string over the stored ceiling', () => {
    const huge = `data:image/webp;base64,${'A'.repeat(ICON_LIMITS.maxChars)}`;
    expect(normalizeInstanceIcon(huge)).toBeNull();
  });

  it('never throws on junk, because it runs during render', () => {
    for (const junk of [null, undefined, 42, {}, [], '', 'not a url', '://']) {
      expect(normalizeInstanceIcon(junk)).toBeNull();
    }
  });
});

describe('instanceInitial', () => {
  it('is the name’s first letter, uppercased', () => {
    expect(instanceInitial('speedrun')).toBe('S');
    expect(instanceInitial('  trailing space  ')).toBe('T');
  });

  it('is never empty, so the tile always renders something', () => {
    expect(instanceInitial('')).toBe('?');
    expect(instanceInitial('   ')).toBe('?');
  });

  it('passes non-Latin scripts through rather than rejecting them', () => {
    // toUpperCase is a no-op for these; the point is that a name the user is
    // entitled to choose still produces a tile rather than the '?' fallback.
    expect(instanceInitial('日本語')).toBe('日');
    expect(instanceInitial('привет')).toBe('ПРИВЕТ'[0]);
  });
});

describe('instanceIconFromUrl', () => {
  it('returns a reason for every refusal, unlike the render-time filter', () => {
    // This is the whole reason the two functions exist separately: an input
    // handler owes the user a sentence, a render filter owes them a letter tile.
    expect(instanceIconFromUrl('')).toEqual({ ok: false, error: expect.stringContaining('paste') });
    expect(instanceIconFromUrl('nonsense')).toEqual({
      ok: false,
      error: expect.stringContaining('not a URL'),
    });
    expect(instanceIconFromUrl('ftp://example.com/i.png')).toEqual({
      ok: false,
      error: expect.stringContaining('ftp:'),
    });
    expect(instanceIconFromUrl('https://cdn.kodub.com/i.png')).toEqual({
      ok: false,
      error: expect.stringContaining('game proxy'),
    });
  });

  it('accepts a data URI under the ceiling and refuses one over it', () => {
    expect(instanceIconFromUrl('data:image/png;base64,AA')).toEqual({
      ok: true,
      icon: 'data:image/png;base64,AA',
    });
    const huge = `data:image/png;base64,${'A'.repeat(ICON_LIMITS.maxChars)}`;
    expect(instanceIconFromUrl(huge)).toEqual({ ok: false, error: expect.stringContaining('large') });
  });

  it('trims, so a pasted URL with stray whitespace still works', () => {
    expect(instanceIconFromUrl('  https://example.com/i.png  ')).toEqual({
      ok: true,
      icon: 'https://example.com/i.png',
    });
  });
});

describe('centerCropSquare', () => {
  it('takes the middle square of a wide image', () => {
    expect(centerCropSquare(200, 100)).toEqual({ sx: 50, sy: 0, side: 100 });
  });

  it('takes the middle square of a tall image', () => {
    expect(centerCropSquare(100, 300)).toEqual({ sx: 0, sy: 100, side: 100 });
  });

  it('is a no-op on an already-square image', () => {
    expect(centerCropSquare(128, 128)).toEqual({ sx: 0, sy: 0, side: 128 });
  });

  it('never returns a zero side, which would make drawImage a no-op', () => {
    expect(centerCropSquare(0, 0).side).toBe(1);
    expect(centerCropSquare(10, 0).side).toBe(1);
  });

  it('never returns a negative offset', () => {
    const { sx, sy } = centerCropSquare(1, 1000);
    expect(sx).toBeGreaterThanOrEqual(0);
    expect(sy).toBeGreaterThanOrEqual(0);
  });
});

describe('drawToDataUrl', () => {
  it('draws the center crop into a square of ICON_LIMITS.pixels', () => {
    const { deps, calls } = fakeDeps('data:image/webp;base64,AA');
    const out = drawToDataUrl({ width: 400, height: 200, source: {} as CanvasImageSource }, deps);
    expect(out).toBe('data:image/webp;base64,AA');
    expect(calls.size).toBe(ICON_LIMITS.pixels);
    // The destination rect is the full 128px square, and the source rect is the
    // centered crop — this is the assertion that the picture is not squashed.
    expect(calls.drew[0]).toEqual([
      expect.anything(),
      100, 0, 200, 200,
      0, 0, ICON_LIMITS.pixels, ICON_LIMITS.pixels,
    ]);
  });

  it('asks for WebP, the format that keeps the stored string small', () => {
    const { deps, calls } = fakeDeps('data:image/webp;base64,AA');
    drawToDataUrl({ width: 10, height: 10, source: {} as CanvasImageSource }, deps);
    expect(calls.encoded?.[0]).toBe('image/webp');
  });

  it('returns null rather than throwing when 2D is unavailable', () => {
    const { deps } = fakeDeps('data:image/webp;base64,AA', { noContext: true });
    expect(drawToDataUrl({ width: 10, height: 10, source: {} as CanvasImageSource }, deps)).toBeNull();
  });
});

describe('fileToInstanceIcon', () => {
  it('downscales rather than storing the file it was given', async () => {
    const { deps, calls } = fakeDeps('data:image/webp;base64,SMALL');
    const result = await fileToInstanceIcon(fakeFile('image/png', 4 * 1024 * 1024), deps);
    expect(result).toEqual({ ok: true, icon: 'data:image/webp;base64,SMALL' });
    // A 4 MB source produced a string of a handful of characters. This is the
    // property the whole module exists for.
    expect(calls.size).toBe(ICON_LIMITS.pixels);
  });

  it('refuses a non-image before decoding anything', async () => {
    const { deps, calls } = fakeDeps('x');
    const result = await fileToInstanceIcon(fakeFile('application/pdf', 1000, 'notes.pdf'), deps);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('notes.pdf') });
    expect(calls.size).toBeNull();
  });

  it('refuses an oversized source with a size in the message, not a frozen tab', async () => {
    const { deps, calls } = fakeDeps('x');
    const result = await fileToInstanceIcon(
      fakeFile('image/png', ICON_LIMITS.maxSourceBytes + 1),
      deps,
    );
    expect(result).toEqual({ ok: false, error: expect.stringContaining('MB') });
    expect(calls.size).toBeNull();
  });

  it('returns a reason when the decode fails, rather than rejecting', async () => {
    const deps: IconCanvasDeps = {
      ...fakeDeps('x').deps,
      decode: async () => {
        throw new Error('unsupported codec');
      },
    };
    const result = await fileToInstanceIcon(fakeFile('image/heic', 1000), deps);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('decoded') });
  });

  it('refuses an image with no pixels', async () => {
    const deps: IconCanvasDeps = {
      ...fakeDeps('x').deps,
      decode: async () => ({ width: 0, height: 0, source: {} as CanvasImageSource }),
    };
    expect(await fileToInstanceIcon(fakeFile('image/png', 10), deps)).toEqual({
      ok: false,
      error: expect.stringContaining('no pixels'),
    });
  });

  it('refuses an encode that came back over the ceiling', async () => {
    // The encoder is a heuristic, not a guarantee. Storing an overrun would
    // spend the budget the mod pool depends on, and fail silently when it does.
    const { deps } = fakeDeps(`data:image/webp;base64,${'A'.repeat(ICON_LIMITS.maxChars)}`);
    expect(await fileToInstanceIcon(fakeFile('image/png', 10), deps)).toEqual({
      ok: false,
      error: expect.stringContaining('compress'),
    });
  });

  it('reports a missing canvas as a sentence, not a crash', async () => {
    const { deps } = fakeDeps('x', { noContext: true });
    expect(await fileToInstanceIcon(fakeFile('image/png', 10), deps)).toEqual({
      ok: false,
      error: expect.stringContaining('canvas'),
    });
  });
});
