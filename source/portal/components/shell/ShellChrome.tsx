import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { Icon } from '@/app/icons';

/**
 * The launcher's frame: brand bar, a nav rail, and the routed page beside it.
 *
 * Server-rendered and stateless on purpose. It reads no storage and holds no
 * client state, so it can wrap every `(shell)` route without forcing those
 * routes to be client components — and, more usefully, so it renders
 * identically on both sides and can never be the cause of a hydration mismatch.
 *
 * Marking the active link is left to CSS via `aria-current`, which the pages
 * set themselves. A `usePathname()` here would turn the whole frame into a
 * client component to move one underline.
 *
 * This must never wrap `/play`. The route group exists for exactly that: a nav
 * bar around a running game is the wrong surface, and anything mounted here
 * shares a render pass with the iframe.
 */
export function ShellChrome({
  children,
  /** Which rail item is current. `browse` arrives with the registry slice. */
  active,
}: {
  children: ReactNode;
  active?: 'instances' | undefined;
}): ReactElement {
  return (
    <div className="shell">
      <header className="topbar shell-topbar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 22px
              static SVG; next/image adds nothing here. */}
          <img src="/logo.svg" alt="" className="brand-logo" />
          <h1>TSPML</h1>
          <span className="brand-sub">launcher</span>
        </div>
        <div className="topbar-side">
          <a
            className="docs-link"
            href="https://tspml-docs.vercel.app"
            target="_blank"
            rel="noreferrer"
          >
            Docs <Icon name="external" />
          </a>
        </div>
      </header>
      <div className="shell-body">
        <nav className="nav-rail" aria-label="Launcher">
          <Link
            className="nav-item"
            href="/"
            aria-current={active === 'instances' ? 'page' : undefined}
          >
            <Icon name="grid" /> Instances
          </Link>
          {/* Browse lands with the registry slice. A disabled-looking rail
              item for a route that 404s would be worse than its absence. */}
        </nav>
        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
}
