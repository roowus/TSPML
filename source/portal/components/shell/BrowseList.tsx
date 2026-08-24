'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { Icon } from '@/app/icons';
import { Catalog } from './Catalog';
import { useInstall } from './useInstall';

/**
 * The `/browse` route's body: the shared {@link Catalog} plus the framing that
 * only makes sense on a page with no game running — a heading, the "this is a
 * curated list" disclaimer, and a Play link once something has been installed.
 *
 * Installs here go to the launcher's target (write the pool, say it loads next
 * time), because there is no iframe on this route to load anything into.
 */
export function BrowseList(): ReactElement {
  const install = useInstall();

  return (
    <section className="shell-section">
      <div className="browse-head">
        <h2>Browse</h2>
        {install.installedAny ? (
          <Link className="btn btn-play" href="/play">
            <Icon name="play" /> Play
          </Link>
        ) : null}
      </div>
      <p className="meta">
        A curated list, not a search index. Every entry here is a mod someone has to add by
        pull request, so it is small on purpose and has no ratings or download counts. You can
        still add any mod by URL from the play page.
      </p>

      <Catalog install={install} />
    </section>
  );
}
