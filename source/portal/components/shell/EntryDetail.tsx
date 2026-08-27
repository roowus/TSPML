'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { Icon } from '@/app/icons';
import { DEFAULT_GAME_VERSION } from '@/lib/game-versions';
import {
  buildsForGameVersion,
  entryPersons,
  entryTags,
  gameVersionNote,
  getRegistryEntry,
  listRegistry,
  resolveDependencies,
  resolveSourceUrl,
  type Registry,
  type RegistryEntry,
} from '@/lib/registry';
import { InstallButton } from './InstallButton';
import { useInstall } from './useInstall';

/**
 * One catalog entry, at its own URL so it can be linked to. That shareability is
 * the reason `/browse/[id]` is a real route rather than a modal.
 *
 * What it deliberately does NOT show, because there is nothing behind it: a
 * version table, a changelog, download counts, ratings, or a screenshot gallery.
 * Mods are fetched live from a URL and there is no version history to page
 * through — "latest at this URL" is the only channel that exists, and the page
 * says so instead of implying a release archive.
 *
 * A deep link never auto-installs. Arriving here from a link someone sent you is
 * exactly the case the confirm step in `InstallButton` exists for.
 */
export function EntryDetail({ id }: { id: string }): ReactElement {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  if (error !== null) {
    return (
      <section className="shell-section">
        <p className="empty-note">{error}</p>
        <Link className="nav-back" href="/browse">
          Back to Browse
        </Link>
      </section>
    );
  }

  // null means "not loaded yet", which must not render as "no such mod".
  if (registry === null) {
    return (
      <section className="shell-section">
        <p className="meta">Loading…</p>
      </section>
    );
  }

  const entry = getRegistryEntry(registry, id);
  if (entry === null) {
    return (
      <section className="shell-section">
        <h2>Not in the catalog</h2>
        <p className="meta">
          Nothing here is listed as <code>{id}</code>. The catalog is curated and small, so a
          link can outlive an entry.
        </p>
        <Link className="nav-back" href="/browse">
          Back to Browse
        </Link>
      </section>
    );
  }

  const deps = resolveDependencies(registry, entry);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  // This page is reached from the launcher, with no instance in hand, so the
  // default is the honest reference point. The in-play drawer knows better and
  // passes the running instance's version to the catalog instead.
  const versionNote = gameVersionNote(entry, DEFAULT_GAME_VERSION);
  // Same set the card builds, so the person chips read identically on both
  // surfaces — a name that is dashed-and-italic on a card and plain here would
  // look like two different facts.
  const persons = new Set(entryPersons(entry));

  return (
    <section className="shell-section">
      <Link className="nav-back" href="/browse">
        Back to Browse
      </Link>
      <div className="entry-detail-head">
        {entry.icon === undefined ? (
          <i className="entry-tile entry-tile-lg" aria-hidden="true">
            {entry.name.slice(0, 1).toUpperCase()}
          </i>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- already
          // host-checked by registryIcon.
          <img className="entry-tile entry-tile-lg" src={entry.icon} alt="" />
        )}
        <div>
          <h2>{entry.name}</h2>
          <p className="meta">
            by {entry.author} · {entry.kind === 'modpack' ? 'modpack' : 'mod'} ·{' '}
            <code>{entry.id}</code>
          </p>
        </div>
      </div>

      <p className="entry-summary">{entry.summary}</p>

      <div className="entry-tags">
        {entryTags(entry).map((t) => (
          <span
            key={t}
            className={`tag-chip ${t === entry.format ? 'tag-format' : persons.has(t) ? 'tag-person' : 'tag-static'}`}
          >
            {t}
          </span>
        ))}
      </div>

      {/* Before the button, for the same reason it is before the button on the
          card: a player deciding whether to install should meet this while
          deciding, not after. */}
      {versionNote === null ? null : (
        <p className="install-caveat">
          <Icon name="warn" /> {versionNote}
        </p>
      )}

      <InstallButton entry={entry} install={install} />

      {install.installedAny ? (
        <p className="meta">
          <Link className="inline-link" href="/play">
            Go play
          </Link>{' '}
          — installed mods load the next time the game starts.
        </p>
      ) : null}

      <dl className="entry-facts">
        <dt>Game versions</dt>
        <dd>
          {entry.gameVersions.join(', ')}
          {/* The list alone reads as a fact with no verdict attached: a row
              saying "0.5.0, 0.5.1, 0.5.2" states the problem only to a reader
              who already knows which version they are on. Both branches are
              derived from the same predicate the advisory above uses. */}
          <span className="meta">
            {buildsForGameVersion(entry, DEFAULT_GAME_VERSION)
              ? ` — covers ${DEFAULT_GAME_VERSION}, the version this launcher plays.`
              : ` — none of these is ${DEFAULT_GAME_VERSION}, the version this launcher plays.`}
          </span>
        </dd>

        <dt>Format</dt>
        <dd>
          {entry.format === 'pml'
            ? 'PolyModLoader (PML). Installs through TSPML’s compatibility adapter — see the note on the Install button for what carries across and what does not.'
            : 'TSPML, this launcher’s native format. Runs directly, with nothing translated.'}
        </dd>

        <dt>Source</dt>
        <dd>
          <code className="entry-source">{resolveSourceUrl(entry, origin)}</code>
          <span className="meta">
            {entry.source.type === 'mod-root'
              ? 'A mod root. Your browser reads the index there, follows it to the build for this game version, and fetches that build’s code. '
              : ''}
            Fetched live by your browser when you install, and again when you press reload on the
            play page. There is no version history: whatever is at that URL is what you get.
          </span>
        </dd>

        <dt>Leaderboard</dt>
        <dd>
          {entry.safety.leaderboardRisk === 'none'
            ? 'No effect on your times.'
            : entry.safety.leaderboardRisk === 'low'
              ? 'May affect how the game plays. Times are probably still comparable.'
              : 'Changes how the game plays. Your times will not be comparable to unmodded runs.'}
          {entry.safety.touchesPhysics
            ? ' This mod patches physics constants, so it is flagged in the game and its runs are marked.'
            : ''}
        </dd>

        {deps.resolved.length > 0 || deps.missing.length > 0 ? (
          <>
            <dt>Needs</dt>
            <dd>
              {deps.resolved.map((d) => (
                <Link key={d.id} className="inline-link" href={`/browse/${encodeURIComponent(d.id)}`}>
                  {d.name}
                </Link>
              ))}
              {deps.missing.length > 0 ? (
                <span className="install-blocked">
                  <Icon name="warn" /> not in this catalog: {deps.missing.join(', ')}. Install those
                  by URL from the play page, or this mod may not load.
                </span>
              ) : null}
            </dd>
          </>
        ) : null}

        {entry.homepage !== undefined || entry.docs !== undefined ? (
          <>
            <dt>Links</dt>
            <dd className="entry-links">
              {entry.homepage !== undefined ? (
                <a className="inline-link" href={entry.homepage} target="_blank" rel="noreferrer">
                  Site <Icon name="external" />
                </a>
              ) : null}
              {entry.docs !== undefined ? (
                <a className="inline-link" href={entry.docs} target="_blank" rel="noreferrer">
                  Docs <Icon name="external" />
                </a>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
