/**
 * @tspml/portal — analytics (Google Analytics 4, gtag.js).
 *
 * Enabled ONLY when `NEXT_PUBLIC_GA_ID` is set at build time (a GA4
 * measurement id, `G-XXXXXXXXXX`). Without it every function here is a no-op:
 * local dev, forks, and CI smokes run with analytics fully absent — no script
 * tag, no network calls, nothing to mock.
 *
 * What we track and, more importantly, what we never track:
 * - **Mod IDs only.** Events carry the manifest `id` slug (`cool-cars`) and
 *   coarse counts/booleans. Mod CODE, mixin contents, import URLs, and share
 *   URLs never leave the browser through this module — a URL can name a
 *   private repo or a user's own host, which is none of our business.
 * - Page views come from GA's default config; the custom events below cover
 *   the questions the defaults can't answer ("which mods do people actually
 *   run?").
 *
 * The service worker doesn't intercept googletagmanager.com requests (it only
 * rewrites kodub-bound and bundle-path requests), so gtag traffic flows
 * normally without SW changes.
 */

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? '';

/** Params GA accepts on a custom event: flat string/number/boolean values. */
type EventParams = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Send a GA4 custom event. Safe to call unconditionally: no-ops when GA is
 * not configured, when the script hasn't loaded yet is fine too (gtag.js
 * drains the dataLayer it finds on load), and never throws — analytics must
 * not be able to break the portal.
 */
export function trackEvent(name: string, params: EventParams = {}): void {
  if (GA_ID === '' || typeof window === 'undefined') return;
  try {
    window.dataLayer = window.dataLayer ?? [];
    if (typeof window.gtag !== 'function') {
      window.gtag = function gtag() {
        // gtag pushes `arguments` (not a spread array) by contract.
        // eslint-disable-next-line prefer-rest-params
        window.dataLayer!.push(arguments);
      };
    }
    window.gtag('event', name, params);
  } catch {
    // Never let analytics surface as a portal error.
  }
}

/**
 * The mod-usage events, named here so call sites and any future dashboard
 * agree on the vocabulary:
 * - `mod_added`    { mod_id, method: 'paste' | 'url' | 'modpack' | 'share' | 'reload' | 'registry' }
 *   `registry` is a launcher install from the curated catalog. Kept distinct
 *   from `url` even though the machinery is identical: the question worth
 *   answering is whether browsing finds people mods they would not have typed
 *   a URL for, and folding the two together makes that unanswerable.
 * - `mod_loaded`   { mod_id } — one per mod per successful load pass
 * - `mod_load_failed` { mod_id } — the mod's id, not the reason (reasons can
 *   quote manifest contents; the Log section shows them to the user instead)
 * - `mods_session` { count } — how many mods a load pass ran with
 */
export function trackModAdded(
  modId: string | null,
  method: 'paste' | 'url' | 'modpack' | 'share' | 'reload' | 'registry',
): void {
  trackEvent('mod_added', { mod_id: modId ?? '(no id)', method });
}

export function trackModsLoaded(loadedIds: readonly string[], failedIds: readonly string[]): void {
  for (const id of loadedIds) trackEvent('mod_loaded', { mod_id: id });
  for (const id of failedIds) trackEvent('mod_load_failed', { mod_id: id });
  trackEvent('mods_session', { count: loadedIds.length });
}
