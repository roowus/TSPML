/**
 * @tspml/portal — instance icons: choosing, shrinking, and validating the
 * picture that identifies a launch profile.
 *
 * An instance icon is a different problem from a MOD icon, and the difference
 * is who supplies it. `userModIcon` renders a string an ARBITRARY THIRD PARTY
 * wrote into a manifest, so its whole job is refusing everything that is not
 * inert inside an `<img>`. An instance icon is chosen by the person looking at
 * it, on their own machine, for their own launcher. The trust question is
 * softer; the QUOTA question is much harder.
 *
 * ## Why uploads are downscaled rather than stored
 *
 * The instance store shares one ~5 MB localStorage budget with
 * `tspml.userMods.v1`, whose per-mod cap alone is 2 MB. A phone photo dropped
 * into a file picker is routinely 3-8 MB, and base64 inflates it by a further
 * third. Storing one verbatim would not merely be wasteful: `saveInstances` and
 * `saveUserMods` both return `false` rather than throwing when a write fails,
 * so the failure mode is a silent one. The user would set an icon, see it (it
 * is in memory), and later find the icon gone AND, far worse, discover that a
 * mod they added afterwards never persisted either — because the icon ate the
 * budget the mod needed.
 *
 * So an upload is never stored as uploaded. {@link fileToInstanceIcon} draws it
 * to a canvas at {@link ICON_LIMITS.pixels} and re-encodes to WebP, which puts
 * a hard ceiling on the stored size no matter what came in. The cap is checked
 * again after encoding ({@link ICON_LIMITS.maxChars}) because encoders are
 * heuristics, not guarantees.
 *
 * ## Why URLs are still allowed
 *
 * Downscaling costs the picture some fidelity, and someone who already hosts an
 * image should not have to pay that. A URL also costs the store almost nothing.
 * URLs get the same host rules `userModIcon` applies, for the same reasons:
 * http(s) only, and never a kodub host, because the service worker rewrites
 * those into the game proxy and images must not transit it.
 */

/** Bounds on a stored instance icon. */
export const ICON_LIMITS = {
  /**
   * The square the upload path downscales into. Rendered at 40-72 CSS px, so
   * 128 covers a 2x display with room to spare; larger buys nothing visible and
   * costs the quota linearly.
   */
  pixels: 128,
  /**
   * Refuse before decoding anything bigger than this. Not a security boundary
   * (the downscale is what bounds the STORED size) — it is there so a user who
   * picks a 40 MB RAW file gets a sentence instead of a frozen tab.
   */
  maxSourceBytes: 8 * 1024 * 1024,
  /**
   * Ceiling on the stored string. A 128px WebP lands near 3-6 KB; 96 KB is far
   * above that, so tripping this means the encode misbehaved and the honest
   * move is to refuse rather than to quietly spend the budget.
   */
  maxChars: 96 * 1024,
} as const;

/** What the picker accepts. Bitmap formats every target browser can decode. */
export const ICON_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/**
 * Validate a stored or pasted instance-icon string for rendering.
 *
 * Mirrors `userModIcon`'s posture. Returns the renderable string or null; never
 * throws, because it runs during render for every card on the launcher.
 *
 * `data:image/*` is accepted because that is what the upload path produces. An
 * `<img>` cannot navigate, and SVG loaded as an image does not execute script,
 * so a data URI here stays display-only — but note that the upload path only
 * ever WRITES WebP, so an SVG data URI could only arrive from someone
 * hand-editing their own localStorage.
 */
export function normalizeInstanceIcon(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.length > ICON_LIMITS.maxChars) return null;
  if (/^data:image\//i.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname === 'kodub.com' || url.hostname.endsWith('.kodub.com')) return null;
  return url.href;
}

/** The letter shown when an instance has no icon. Never empty. */
export function instanceInitial(name: string): string {
  const ch = name.trim()[0];
  return ch === undefined ? '?' : ch.toUpperCase();
}

export type IconResult = { ok: true; icon: string } | { ok: false; error: string };

/**
 * A URL typed or pasted into the icon field.
 *
 * Separate from {@link normalizeInstanceIcon} because the two have different
 * jobs: that one is a silent render-time filter (a bad value shows the letter
 * tile), this one is an input handler that owes the user a REASON. Same rules,
 * different failure surface.
 */
export function instanceIconFromUrl(raw: string): IconResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: 'paste an image URL first' };
  if (/^data:image\//i.test(trimmed)) {
    return trimmed.length > ICON_LIMITS.maxChars
      ? { ok: false, error: 'that data URI is too large to store' }
      : { ok: true, icon: trimmed };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'that is not a URL — it needs the https:// too' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: `${url.protocol} links can’t be used as an icon — use http(s)` };
  }
  if (url.hostname === 'kodub.com' || url.hostname.endsWith('.kodub.com')) {
    return { ok: false, error: 'kodub.com images can’t be used — that host is the game proxy' };
  }
  return { ok: true, icon: url.href };
}

/**
 * Decode-bounds for the canvas step, injectable so the node test suite can
 * drive {@link drawToDataUrl} without a DOM.
 */
export interface IconCanvasDeps {
  readonly createCanvas: (size: number) => {
    getContext(id: '2d'): {
      clearRect(x: number, y: number, w: number, h: number): void;
      drawImage(
        img: CanvasImageSource,
        sx: number, sy: number, sw: number, sh: number,
        dx: number, dy: number, dw: number, dh: number,
      ): void;
    } | null;
    toDataURL(type?: string, quality?: number): string;
  };
  readonly decode: (file: Blob) => Promise<{ width: number; height: number; source: CanvasImageSource }>;
}

/**
 * The center-crop maths, factored out so it is unit-testable without a canvas.
 *
 * Crops to a centered square BEFORE scaling rather than squashing the image to
 * fit. A letterboxed icon in a grid of square tiles reads as a rendering bug,
 * and a stretched face reads as a worse one; losing the edges of a wide photo
 * is the outcome people expect from an avatar picker.
 */
export function centerCropSquare(
  width: number,
  height: number,
): { sx: number; sy: number; side: number } {
  const side = Math.max(1, Math.min(width, height));
  return {
    sx: Math.max(0, Math.round((width - side) / 2)),
    sy: Math.max(0, Math.round((height - side) / 2)),
    side,
  };
}

function browserDeps(): IconCanvasDeps {
  return {
    createCanvas: (size) => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      return c;
    },
    decode: async (file) => {
      // createImageBitmap is the path that does NOT need a document node or a
      // load event, and it decodes off the main thread where supported. Falling
      // back to an <img> + object URL keeps older Safari working.
      if (typeof createImageBitmap === 'function') {
        const bmp = await createImageBitmap(file);
        return { width: bmp.width, height: bmp.height, source: bmp };
      }
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return { width: img.naturalWidth, height: img.naturalHeight, source: img };
      } finally {
        // Revoked in a finally: an early return on a decode failure would
        // otherwise leak the object URL for the life of the document.
        URL.revokeObjectURL(url);
      }
    },
  };
}

/**
 * Turn a picked file into a stored icon: decode, center-crop, downscale to
 * {@link ICON_LIMITS.pixels}, re-encode as WebP.
 *
 * Every failure is a returned reason rather than a throw. This runs from a file
 * input change handler, where the realistic failures — a corrupt file, an
 * unsupported codec, a HEIC the browser will not decode — are all things the
 * user can act on if told, and all things that would otherwise surface as an
 * unhandled rejection in a console they are not reading.
 */
export async function fileToInstanceIcon(
  file: File,
  deps: IconCanvasDeps = browserDeps(),
): Promise<IconResult> {
  if (!/^image\//i.test(file.type)) {
    return { ok: false, error: `${file.name} isn’t an image` };
  }
  if (file.size > ICON_LIMITS.maxSourceBytes) {
    const mb = (ICON_LIMITS.maxSourceBytes / (1024 * 1024)).toFixed(0);
    return { ok: false, error: `that image is over ${mb} MB — pick a smaller one` };
  }
  let decoded: { width: number; height: number; source: CanvasImageSource };
  try {
    decoded = await deps.decode(file);
  } catch {
    return { ok: false, error: 'that image couldn’t be decoded — try a PNG, JPEG, or WebP' };
  }
  if (decoded.width < 1 || decoded.height < 1) {
    return { ok: false, error: 'that image has no pixels in it' };
  }
  const icon = drawToDataUrl(decoded, deps);
  if (icon === null) return { ok: false, error: 'this browser wouldn’t give us a canvas to resize with' };
  if (icon.length > ICON_LIMITS.maxChars) {
    // Reached only if the encoder ignored the size we asked for. Refusing beats
    // storing it: the store is shared with the mod pool and overrunning it
    // fails silently, which is the one outcome worth spending an error on.
    return { ok: false, error: 'that image wouldn’t compress small enough to store' };
  }
  return { ok: true, icon };
}

/** The canvas half of {@link fileToInstanceIcon}. Null when 2D is unavailable. */
export function drawToDataUrl(
  decoded: { width: number; height: number; source: CanvasImageSource },
  deps: IconCanvasDeps,
): string | null {
  const size = ICON_LIMITS.pixels;
  const canvas = deps.createCanvas(size);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const { sx, sy, side } = centerCropSquare(decoded.width, decoded.height);
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(decoded.source, sx, sy, side, side, 0, 0, size, size);
  // WebP at 0.82: visually clean at this size and roughly half the bytes of the
  // equivalent PNG. A browser that cannot encode WebP returns a PNG data URI
  // from toDataURL instead of failing, which is a fine outcome — the length
  // check downstream is what actually enforces the budget.
  return canvas.toDataURL('image/webp', 0.82);
}
