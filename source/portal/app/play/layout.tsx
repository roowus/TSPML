import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Wrapper for the play surface. It exists for one reason: `page.tsx` is a
 * client component and a client component cannot export `metadata`, so the
 * route's title has to be declared from a server component alongside it.
 *
 * Deliberately renders nothing of its own. Launcher chrome lives in
 * `app/(shell)/layout.tsx` and must never wrap this route — a nav bar around a
 * running game is the wrong surface, and anything that mounts here shares a
 * render pass with the iframe.
 */
export const metadata: Metadata = {
  title: 'Play — TSPML',
  description:
    'Play PolyTrack in your browser with mods loaded by TSPML. Add a mod by paste or URL and it runs in the game on this page.',
};

export default function PlayLayout({ children }: { children: ReactNode }) {
  return children;
}
