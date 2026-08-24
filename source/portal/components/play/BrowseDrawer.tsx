'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import { Icon } from '@/app/icons';
import { Catalog } from '@/components/shell/Catalog';
import type { UseInstall } from '@/components/shell/useInstall';

/**
 * Browsing the catalog WITHOUT leaving the running game.
 *
 * This is an overlay and not a route, and that is a hard constraint rather than
 * a preference. The game lives in an iframe whose mount is gated on
 * `swState === 'active' && planReady` because the mixin and physics plans must
 * be parked in the Cache API before the frame's first bundle fetch. A client-side
 * navigation to `/browse` unmounts that iframe, and coming back re-runs the whole
 * boot: the run is lost, every mod reloads, and the parked plans are re-derived.
 * So the drawer mounts as a SIBLING of `section.stage` inside `div.content` and
 * the iframe never leaves the tree.
 *
 * Two consequences show up in the props rather than in here:
 *
 *   - `install` is the play page's target, not the launcher's. Installing from
 *     here re-parks the plans and reloads the mod set live, so the button can
 *     honestly say the mod is running. The launcher's target cannot do that and
 *     says so instead.
 *   - `linkEntries={false}` on the Catalog: an entry's title is a `<Link>` to
 *     `/browse/<id>` on the browse page, and following one from here would be
 *     the same navigation that kills the game. In the drawer the card carries
 *     everything the detail page would show that matters at install time.
 *
 * The panel is `hidden` rather than unmounted when closed so its fetched catalog,
 * search text, and tab survive a close/reopen. Reopening to a blank list that
 * refetches would make the drawer feel like a page, which is precisely what it
 * is not.
 */
export function BrowseDrawer({
  open,
  onClose,
  install,
}: {
  open: boolean;
  onClose: () => void;
  install: UseInstall;
}): ReactElement {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Esc closes, matching the theater-mode handler this page already has. Bound
  // only while open so it cannot swallow a key the game wants: the game runs in
  // a cross-document iframe and never sees this listener, but the sidebar's own
  // controls are in this document and do.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus moves into the panel on open so the keyboard lands somewhere useful
  // and a screen reader announces the dialog rather than leaving the user on a
  // button that is now behind an overlay.
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  return (
    <div
      ref={panelRef}
      className="browse-drawer"
      role="dialog"
      aria-modal="false"
      aria-label="Browse mods"
      hidden={!open}
    >
      <div className="drawer-head">
        <h2>Browse</h2>
        <button
          ref={closeRef}
          type="button"
          className="btn drawer-close"
          onClick={onClose}
          aria-label="Close browse"
        >
          <Icon name="close" /> Close
        </button>
      </div>
      <p className="meta">
        A curated list, not a search index. Installing from here loads the mod into the game
        you are already playing, so a run in progress restarts.
      </p>
      <Catalog install={install} linkEntries={false} />
    </div>
  );
}
