'use client';

import { useState } from 'react';
import type { ReactElement } from 'react';

import { instanceInitial } from '@/lib/instance-icon';

/**
 * An instance's picture: the chosen image when there is one, the name's first
 * letter otherwise.
 *
 * Shaped like {@link ModTile} and deliberately not merged with it. That one
 * renders a string an unknown mod author wrote and carries a DOM contract (it
 * must stay an `<i>` so a mod row's first `<span>` is the status pill); this
 * one renders a string the user chose for their own launcher and has no such
 * constraint. Merging them would tie two different trust stories and two
 * different test contracts to one component.
 *
 * `icon` has been through `normalizeInstanceIcon` (http(s) or `data:image`,
 * never a kodub host) before it gets here. A broken image falls back to the
 * letter rather than the browser's broken-image glyph, keyed to the URL so
 * fixing the URL retries.
 *
 * `size` is a CSS custom property rather than a class per size: the tile shows
 * up at three scales (grid card, detail header, the play page's launch chip)
 * and a variant class for each would be three rules that can drift apart.
 */
export function InstanceTile({
  name,
  icon,
  size = 44,
}: {
  name: string;
  icon: string | null;
  size?: number;
}): ReactElement {
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  const showImg = icon !== null && icon !== failedIcon;
  return (
    <span
      className="inst-tile"
      aria-hidden="true"
      style={{ '--tile-size': `${size}px` } as React.CSSProperties}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element -- user-chosen
        // arbitrary origins and data: URIs; next/image needs a domain allowlist
        // and cannot optimize a data URI at all.
        <img src={icon} alt="" onError={() => setFailedIcon(icon)} />
      ) : (
        instanceInitial(name)
      )}
    </span>
  );
}
