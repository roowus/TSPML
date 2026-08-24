'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Icon } from '@/app/icons';
import {
  listRegistry,
  registryTags,
  searchRegistry,
  type Registry,
  type RegistryEntry,
  type RegistryKind,
} from '@/lib/registry';
import { InstallButton } from './InstallButton';
import { useInstall } from './useInstall';

/**
 * Browse the curated catalog: tabs for Mods and Modpacks, a search box, and a
 * tag filter. All three filter the SAME already-loaded array in the browser.
 *
 * There is no backend, and the UI is explicit about that rather than dressing a
 * list of tens of entries as a search index. No ratings, no download counts, no
 * "trending" — inventing social proof from nothing would be the dishonest part
 * of copying a storefront's shape.
 *
 * The catalog is fetched on mount rather than server-rendered so this file stays
 * a client component with the install path in it, and so a registry failure is a
 * visible in-page message instead of a 500 on a route whose real job is browsing.
 */
export function BrowseList(): ReactElement {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<RegistryKind>('mod');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const install = useInstall();

  useEffect(() => {
    let live = true;
    void listRegistry().then((r) => {
      if (!live) return;
      if (r.ok) setRegistry(r.registry);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, []);

  const all = registry?.entries ?? [];
  const ofKind = useMemo(() => all.filter((e) => e.kind === kind), [all, kind]);
  // Tags come from the CURRENT tab's entries, so the filter row never offers a
  // tag that would empty the list.
  const tags = useMemo(() => registryTags(ofKind), [ofKind]);
  const shown = useMemo(() => searchRegistry(ofKind, query, tag), [ofKind, query, tag]);

  // A tag selected under Mods may not exist under Modpacks. Clearing it on the
  // switch beats showing an empty list whose cause is an invisible filter.
  useEffect(() => {
    if (tag !== null && !tags.includes(tag)) setTag(null);
  }, [tag, tags]);

  return (
    <section className="shell-section">
      <div className="browse-head">
        <h2>Browse</h2>
        {install.installedAny ? (
          <Link className="btn-play" href="/play">
            <Icon name="play" /> Play
          </Link>
        ) : null}
      </div>
      <p className="meta">
        A curated list, not a search index. Every entry here is a mod someone has to add by
        pull request, so it is small on purpose and has no ratings or download counts. You can
        still add any mod by URL from the play page.
      </p>

      <div className="browse-tabs" role="tablist" aria-label="Content type">
        {(['mod', 'modpack'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className="browse-tab"
            onClick={() => setKind(k)}
          >
            {k === 'mod' ? 'Mods' : 'Modpacks'}
          </button>
        ))}
      </div>

      <div className="browse-filters">
        <label className="browse-search">
          <Icon name="search" />
          <span className="sr-only">Search the catalog</span>
          <input
            type="search"
            className="add-input"
            placeholder="Search by name, author, or tag"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {tags.length > 0 ? (
          <div className="tag-row">
            <button
              type="button"
              className="tag-chip"
              aria-pressed={tag === null}
              onClick={() => setTag(null)}
            >
              All
            </button>
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className="tag-chip"
                aria-pressed={tag === t}
                onClick={() => setTag(tag === t ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error !== null ? (
        <p className="empty-note">{error}</p>
      ) : registry === null ? (
        <ul className="browse-grid" aria-hidden="true">
          <li className="entry-card inst-card-skeleton" />
          <li className="entry-card inst-card-skeleton" />
        </ul>
      ) : shown.length === 0 ? (
        <p className="empty-note">
          {ofKind.length === 0
            ? `No ${kind === 'mod' ? 'mods' : 'modpacks'} in the catalog yet.`
            : 'Nothing matches that search.'}
        </p>
      ) : (
        <ul className="browse-grid">
          {shown.map((e) => (
            <EntryCard key={e.id} entry={e} install={install} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function EntryCard({
  entry,
  install,
}: {
  entry: RegistryEntry;
  install: ReturnType<typeof useInstall>;
}): ReactElement {
  return (
    <li className="entry-card">
      <div className="entry-head">
        {entry.icon === undefined ? (
          <i className="entry-tile" aria-hidden="true">
            {entry.name.slice(0, 1).toUpperCase()}
          </i>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- author-hosted
          // and already host-checked by registryIcon; next/image would proxy it.
          <img className="entry-tile" src={entry.icon} alt="" />
        )}
        <div className="entry-title">
          <Link href={`/browse/${encodeURIComponent(entry.id)}`} className="entry-name">
            {entry.name}
          </Link>
          <span className="meta">by {entry.author}</span>
        </div>
      </div>
      <p className="entry-summary">{entry.summary}</p>
      <div className="entry-tags">
        {entry.tags.map((t) => (
          <span key={t} className="tag-chip tag-static">
            {t}
          </span>
        ))}
        {entry.safety.touchesPhysics ? (
          <span className="tag-chip tag-warn">
            <Icon name="warn" /> physics
          </span>
        ) : null}
      </div>
      <InstallButton entry={entry} install={install} />
    </li>
  );
}
