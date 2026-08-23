/**
 * Modpacks as a plain-text list of mod URLs (#80, second slice).
 *
 * A modpack is a `.txt` file: one mod URL per line, `#` for comments. That is
 * the whole format. It needs no backend, no account and no registration — a
 * player shares a gist link and their friend gets their exact setup. The
 * remaining #80 slice (a short modpack ID resolved against a registry) is a
 * lookup that produces one of these lists; getting the list right first means
 * the ID path will be a loop around code that already works.
 *
 * This module only turns text into a checked list of URLs. Importing them is
 * `importModFromUrl`, unchanged and once per line: a modpack is a way to say
 * "these mods", not a second way to install one. Every host rule, cap and
 * failure mode of a single import therefore applies to every line, and one
 * bad line cannot take the pack down with it (#80: fail per mod, not per pack).
 *
 * LINKS ONLY, never code — the same boundary share links commit to. A modpack
 * points at mods their authors host; nothing here ever copies a mod's bytes
 * into a pack, and the portal never becomes a distribution channel.
 *
 * Why no confirm prompt, when an incoming share link has one: a share link
 * arrives from someone else and can be opened by a click, so importing without
 * asking would be a drive-by. A modpack list is something the player pastes or
 * links deliberately, in the Add form, and then presses a button labelled
 * Import. That IS the confirmation.
 */
import { checkImportUrl } from './mod-import';

export const MODPACK_LIMITS = {
  /**
   * Max mods one pack may install. Matches the patch-plan and share-link caps
   * (both 16) so a pack that imports cleanly cannot then exceed the plan's own
   * limit and have its mixins silently trimmed one layer down.
   */
  maxMods: 16,
  /** A list is URLs and comments. 64 KB is thousands of lines. */
  maxListChars: 65_536,
  /** Lines past this are refused unread, so a wrong URL (an HTML page, a
   *  minified bundle) fails on shape rather than after 4000 host checks. */
  maxLines: 512,
  timeoutMs: 20_000,
} as const;

export interface ModpackParseResult {
  /** Deduped, host-checked mod URLs, in list order. */
  readonly urls: string[];
  /** Lines refused by the import URL rules, with the line number the user sees. */
  readonly invalid: { readonly line: number; readonly text: string; readonly error: string }[];
  /** How many URLs past {@link MODPACK_LIMITS.maxMods} were dropped. */
  readonly dropped: number;
}

/**
 * A `.txt` path names a LIST, never a mod: a mod is a `mod.json` or a built
 * `.js`, so the extension disambiguates the two without guessing. Used both to
 * decide that a single pasted line should be fetched as a list, and to refuse a
 * list that points at another list.
 */
function isListUrl(raw: string): boolean {
  try {
    return /\.txt$/i.test(new URL(raw).pathname);
  } catch {
    return false;
  }
}

/** Content lines, in order, with their 1-based line numbers. Blank lines and
 *  `#` comments are dropped; a trailing `#` comment on a URL line is NOT — a
 *  `#` in a URL is a fragment, and stripping it would silently rewrite links. */
function contentLines(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] ?? '').trim();
    if (t.length === 0 || t.startsWith('#')) continue;
    out.push({ line: i + 1, text: t });
  }
  return out;
}

/**
 * Parse a modpack list.
 *
 * `base` is the URL the list itself was fetched from, when it was fetched:
 * lines then resolve against it, so a pack can say `mods/turbo/mod.json` next
 * to itself and stay portable across hosts and forks. A PASTED list has no
 * base, so its lines must be absolute — there is nothing to resolve against,
 * and inventing the portal's own origin as a base would silently point every
 * relative line at a host that serves no mods.
 */
export function parseModpackList(text: string, base?: string): ModpackParseResult {
  const urls: string[] = [];
  const invalid: { line: number; text: string; error: string }[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  const lines = contentLines(text);
  if (lines.length > MODPACK_LIMITS.maxLines) {
    return {
      urls: [],
      invalid: [
        {
          line: MODPACK_LIMITS.maxLines + 1,
          text: '',
          error: `the list has ${lines.length} entries — the limit is ${MODPACK_LIMITS.maxLines}. Is this actually a list of mod URLs?`,
        },
      ],
      dropped: 0,
    };
  }

  for (const entry of lines) {
    // Resolve BEFORE checking: a relative line is not a URL yet, and
    // checkImportUrl would reject it as "not absolute" with advice (add
    // https://) that is wrong for a list line that is allowed to be relative.
    let resolved = entry.text;
    if (base !== undefined) {
      try {
        resolved = new URL(entry.text, base).href;
      } catch {
        invalid.push({ line: entry.line, text: entry.text, error: 'does not resolve against the list URL' });
        continue;
      }
    }
    if (isListUrl(resolved)) {
      // Deliberately not followed. A pack that includes a pack can loop, can
      // fan out past every cap here, and makes "what will this install?"
      // unanswerable from the list in front of the user.
      invalid.push({
        line: entry.line,
        text: entry.text,
        error: 'points at another .txt list — a modpack does not include other modpacks',
      });
      continue;
    }
    const check = checkImportUrl(resolved);
    if (!check.ok) {
      invalid.push({ line: entry.line, text: entry.text, error: check.error });
      continue;
    }
    // Dedupe on the RESOLVED href so the same mod written two ways (relative
    // and absolute) installs once. Re-importing an already-stored mod is
    // separately convergent: upsertUserMod replaces by manifest id.
    if (seen.has(check.url.href)) continue;
    seen.add(check.url.href);
    if (urls.length >= MODPACK_LIMITS.maxMods) {
      dropped++;
      continue;
    }
    urls.push(check.url.href);
  }
  return { urls, invalid, dropped };
}

export type ModpackListResult =
  | { readonly ok: true; readonly parsed: ModpackParseResult; readonly source: string }
  | { readonly ok: false; readonly error: string };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Fetch a modpack list from `rawUrl` and parse it.
 *
 * The fetch is the BROWSER's, like every other #80 fetch — never `/api/proxy`.
 * The server must not become a fetcher of arbitrary user-pointed URLs, and a
 * list is no more trusted than the mods it names.
 */
export async function fetchModpackList(
  rawUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<ModpackListResult> {
  const checked = checkImportUrl(rawUrl);
  if (!checked.ok) return { ok: false, error: checked.error };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MODPACK_LIMITS.timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(checked.url.href, {
      signal: ctrl.signal,
      credentials: 'omit',
      redirect: 'follow',
      // Lists change when the pack's author edits them, and a stale pack is
      // the confusing outcome ("I added a mod, they didn't get it"). The mods
      // it names keep the default cache behaviour of a plain import.
      cache: 'no-cache',
    });
  } catch (e) {
    const detail = e instanceof Error && e.name === 'AbortError' ? 'timed out' : (e as Error).message;
    return {
      ok: false,
      error: `modpack list: fetch failed (${detail}). The host must allow cross-origin reads (CORS) — raw-file URLs (raw.githubusercontent.com, gist raw, jsDelivr) work; regular web pages usually don't.`,
    };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return { ok: false, error: `modpack list: HTTP ${res.status} from ${checked.url.hostname}` };
  const text = await res.text();
  if (text.length > MODPACK_LIMITS.maxListChars) {
    return {
      ok: false,
      error: `modpack list: file is ${text.length.toLocaleString()} characters — the limit is ${MODPACK_LIMITS.maxListChars.toLocaleString()}`,
    };
  }
  return { ok: true, parsed: parseModpackList(text, checked.url.href), source: checked.url.href };
}

export type ModpackInput =
  /** One line, a `.txt` URL: fetch it, then parse what comes back. */
  | { readonly kind: 'list'; readonly url: string }
  /** Everything else: the text in the box IS the list. */
  | { readonly kind: 'inline'; readonly parsed: ModpackParseResult };

/**
 * Decide what the user put in the modpack box.
 *
 * The rule is the extension and nothing cleverer: a mod URL ends in `.json` or
 * `.js`, a list ends in `.txt`, so a lone `.txt` line is a link TO a pack and
 * anything else is the pack itself. A rule the user can predict beats a
 * heuristic that is right more often — when this guesses wrong they see the
 * error from the wrong path and have no way to force the other one.
 */
export function classifyModpackInput(text: string): ModpackInput {
  const lines = contentLines(text);
  const only = lines.length === 1 ? lines[0] : undefined;
  if (only !== undefined && isListUrl(only.text)) return { kind: 'list', url: only.text };
  return { kind: 'inline', parsed: parseModpackList(text) };
}
