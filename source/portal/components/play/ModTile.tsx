'use client';

import { useState } from 'react';
import type { ReactElement } from 'react';

/**
 * The mod card's 30×30 tile: the manifest's icon image when one is set (and
 * loads), the id's first letter otherwise.
 *
 * The element stays an `<i>`, and that is a contract rather than a style
 * choice — `smoke.mjs` reads each mod row's FIRST `<span>` as the status pill,
 * so the tile must not be a span. An `<img>` inside the `<i>` keeps that true.
 *
 * `icon` has already been through `userModIcon` (http(s)/data:image only), so
 * this never renders an author-controlled string anywhere scriptable. A broken
 * image (404, wrong type, blocked by the host) swaps back to the letter via
 * onError instead of showing the browser's broken-image glyph; the error state
 * is keyed to the URL so a fixed URL retries.
 */
export function ModTile({ id, icon }: { id: string; icon: string | null }): ReactElement {
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  const showImg = icon !== null && icon !== failedIcon;
  return (
    <i className="mod-tile" aria-hidden="true">
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary
        // author-hosted origins; next/image needs a domain allowlist.
        <img src={icon} alt="" onError={() => setFailedIcon(icon)} />
      ) : (
        id.replace(/^tspml-/, '').charAt(0).toUpperCase() || 'M'
      )}
    </i>
  );
}
