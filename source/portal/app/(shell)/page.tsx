import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { ShellChrome } from '@/components/shell/ShellChrome';
import { InstanceGrid } from '@/components/shell/InstanceGrid';
import { SHARE_PARAM } from '@/lib/mod-share';

export const metadata: Metadata = {
  title: 'TSPML launcher',
  description:
    'Your PolyTrack instances. Pick one and play it with mods loaded by TSPML, or make a new launch profile.',
};

/**
 * `/` — the launcher. The first thing a visitor sees is their own instances.
 *
 * ## Why this still redirects sometimes
 *
 * Share links in the wild point at `/?mods=<url>`, minted before the play
 * surface moved to `/play`. The previous slice made `/` a blanket redirect,
 * which kept them working for free; now that `/` has a destination of its own,
 * that forwarding has to be explicit or every shared mod set silently becomes a
 * plain visit to the launcher — with no error, and no clue where the mods went.
 *
 * So the rule is narrow: forward ONLY when `mods` is actually present, and
 * forward the whole query string when it is, because `redirect()` sends exactly
 * the path it is handed. Everything else renders the launcher. Nothing is
 * fetched or run by this redirect — the play page still shows the confirm-first
 * prompt, because mod code runs unsandboxed and a link must never be able to
 * execute anything on its own.
 */
export default async function LauncherPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params = await searchParams;
  if (params[SHARE_PARAM] !== undefined) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      // `?mods=a&mods=b` arrives as an array; `mods` is repeatable by design.
      if (Array.isArray(value)) for (const v of value) qs.append(key, v);
      else qs.append(key, value);
    }
    redirect(`/play?${qs.toString()}`);
  }
  return (
    <ShellChrome active="instances">
      <InstanceGrid />
    </ShellChrome>
  );
}
