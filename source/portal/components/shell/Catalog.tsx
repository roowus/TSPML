'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useState, type ReactElement } from 'react';
import { Icon } from '@/app/icons';
import { DEFAULT_GAME_VERSION } from '@/lib/game-versions';
import {
  entryPersons,
  entryTags,
  entryVersions,
  gameVersionNote,
  listRegistry,
  registryTagGroups,
  releaseVersionsIn,
  searchRegistry,
  type Registry,
  type RegistryEntry,
  type RegistryKind,
} from '@/lib/registry';
import { InstallButton } from './InstallButton';
import type { UseInstall } from './useInstall';

/**
 * Tab order, and the arrow-key ring. `satisfies` rather than a plain annotation
 * so a typo here is a compile error AND the array stays a literal tuple, which
 * is what lets `KINDS.indexOf(k)` narrow instead of widening to `string`.
 */
const KINDS = ['mod', 'modpack'] as const satisfies readonly RegistryKind[];

/** The universe a card falls back to when its caller knows no catalog: just the
 *  launcher's own version. A card rendered this way shows at most one chip. */
const DEFAULT_UNIVERSE: readonly string[] = [DEFAULT_GAME_VERSION];

/**
 * The catalog itself: tabs for Mods and Modpacks, a search box, a tag filter,
 * and the grid. All three filter the SAME already-loaded array in the browser.
 *
 * There is no backend, and the UI is explicit about that rather than dressing a
 * list of tens of entries as a search index. No ratings, no download counts, no
 * "trending" — inventing social proof from nothing would be the dishonest part
 * of copying a storefront's shape.
 *
 * The catalog is fetched on mount rather than server-rendered so this stays a
 * client component with the install path in it, and so a registry failure is a
 * visible in-page message instead of a 500 on a route whose real job is browsing.
 *
 * ## Why this is a component and not just the body of {@link BrowseList}
 *
 * It renders in two places that agree on everything except where an install
 * lands: the `/browse` route, and the drawer over a RUNNING game on `/play`.
 * Duplicating the markup would mean a card that installs correctly in one place
 * and not the other, which is exactly the bug class this seam removes. The
 * caller passes the `install` hook it built, and `linkEntries` says whether a
 * card's title navigates — in the drawer it must NOT, because a route change
 * unmounts the game iframe and kills the running game.
 */
export function Catalog({
  install,
  linkEntries = true,
  gameVersion = DEFAULT_GAME_VERSION,
}: {
  install: UseInstall;
  /** False in the in-play drawer: navigating away would stop the game. */
  linkEntries?: boolean;
  /**
   * Which PolyTrack build to judge "has a build for this version" against.
   *
   * The drawer passes the RUNNING instance's version, because there the
   * question has one true answer and it is not the default. `/browse` has no
   * instance in hand and falls back — a catalog opened from the launcher is
   * being read before any instance is chosen.
   *
   * Explicitly `| undefined` so the drawer can forward a not-yet-loaded
   * instance's version straight through under `exactOptionalPropertyTypes`.
   */
  gameVersion?: string | undefined;
}): ReactElement {
  // The drawer and /browse can both be mounted in one document, so the tab and
  // panel ids have to be per-instance or the two tablists cross-wire.
  const idPrefix = useId();
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<RegistryKind>('mod');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  // Bumped by Retry. The fetch effect depends on it, so incrementing re-runs it
  // — which is the whole mechanism, and why the failure state is not a dead end.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    void listRegistry().then((r) => {
      if (!live) return;
      if (r.ok) setRegistry(r.registry);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  const all = registry?.entries ?? [];
  const ofKind = useMemo(() => all.filter((e) => e.kind === kind), [all, kind]);
  // Tags come from the CURRENT tab's entries, so the filter row never offers a
  // tag that would empty the list. Grouped by what KIND of fact a chip states —
  // one flat row of eighteen chips buried its own structure.
  const groups = useMemo(() => registryTagGroups(ofKind), [ofKind]);
  // The version chips expand against the same universe the filter row offers —
  // one derivation, two consumers, agreement by construction.
  const universe = useMemo(() => releaseVersionsIn(ofKind), [ofKind]);
  const tags = useMemo(
    () => [...groups.loaders, ...groups.content, ...groups.versions, ...groups.persons],
    [groups],
  );
  const shown = useMemo(() => searchRegistry(ofKind, query, tag), [ofKind, query, tag]);

  // A tag selected under Mods may not exist under Modpacks. Clearing it on the
  // switch beats showing an empty list whose cause is an invisible filter.
  useEffect(() => {
    if (tag !== null && !tags.includes(tag)) setTag(null);
  }, [tag, tags]);

  return (
    <>
      {/*
        A real tablist, not two buttons wearing the role. `role="tab"` is a
        promise about keyboard behaviour — one tab stop for the whole set, arrows
        to move between them — and a screen-reader user who hears "tab, 1 of 2"
        and then cannot arrow to the second one is worse off than if these had
        stayed plain buttons.

        Roving tabindex: only the selected tab is tabbable, so Tab enters the set
        and then leaves it, rather than making the user step through every tab to
        reach the search box.
      */}
      <div className="browse-tabs" role="tablist" aria-label="Content type">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${k}`}
            aria-selected={kind === k}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={kind === k ? 0 : -1}
            className="browse-tab"
            onClick={() => setKind(k)}
            onKeyDown={(e) => {
              const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (delta === 0) return;
              e.preventDefault();
              // Wraps, per the tabs pattern. Two entries today, so this is
              // mostly a toggle — written as arithmetic so a third kind needs
              // no keyboard change.
              const next = KINDS[(KINDS.indexOf(k) + delta + KINDS.length) % KINDS.length];
              if (next === undefined) return;
              setKind(next);
              // Selection follows focus, and focus has to actually move or the
              // arrow key silently changes the panel under a stationary cursor.
              document.getElementById(`${idPrefix}-tab-${next}`)?.focus();
            }}
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
          /*
            Grouped by type, labelled on screen. The groups are the answer to a
            question the flat row made unanswerable: which chips are people?
            Each keeps the `tag-row` class so every existing locator (smokes
            click `.tag-row button`, shot-check crops `.tag-row`) sees the same
            control it always did — a group IS a row, not a new thing.
          */
          <div className="tag-groups">
            <div className="tag-row" role="group" aria-label="Filter by loader">
              <span className="tag-row-label">loader</span>
              <button
                type="button"
                className="tag-chip"
                aria-pressed={tag === null}
                onClick={() => setTag(null)}
              >
                All
              </button>
              {groups.loaders.map((t) => (
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
            {groups.content.length > 0 ? (
              <div className="tag-row" role="group" aria-label="Filter by category">
                <span className="tag-row-label">category</span>
                {groups.content.map((t) => (
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
            {groups.versions.length > 0 ? (
              <div className="tag-row" role="group" aria-label="Filter by game version">
                <span className="tag-row-label">version</span>
                {groups.versions.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="tag-chip tag-chip-version"
                    aria-pressed={tag === t}
                    onClick={() => setTag(tag === t ? null : t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : null}
            {groups.persons.length > 0 ? (
              <div className="tag-row" role="group" aria-label="Filter by person">
                <span className="tag-row-label">people</span>
                {groups.persons.map((t) => (
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
        ) : null}
      </div>

      {/*
        The panel the tabs control. `tabIndex={-1}` without `role="tabpanel"`
        would be a focusable div with no meaning; with it, the panel is the
        landing spot when a screen-reader user moves past the tab, and its
        aria-labelledby names which tab put it there.

        aria-live so a search that empties the list ANNOUNCES that, rather than
        leaving someone typing into a box whose result they cannot see. Polite,
        because it changes on every keystroke.
      */}
      <div
        id={`${idPrefix}-panel`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${kind}`}
        tabIndex={-1}
        aria-live="polite"
      >
        {error !== null ? (
          // A dead end here would be wrong: the catalog is one same-origin GET
          // of a static file, so the overwhelmingly likely cause is a dropped
          // connection rather than anything a reload would fix better than a
          // retry. In the drawer a reload is not even available — it would
          // restart the game.
          <div className="empty-note">
            <p>{error}</p>
            <button type="button" className="btn btn-small" onClick={() => setAttempt((a) => a + 1)}>
              <Icon name="refresh" /> Try again
            </button>
          </div>
        ) : registry === null ? (
          <ul className="browse-grid" aria-hidden="true">
            <li className="entry-card inst-card-skeleton" />
            <li className="entry-card inst-card-skeleton" />
          </ul>
        ) : shown.length === 0 ? (
          <p className="empty-note">
            {ofKind.length === 0
              ? `No ${kind === 'mod' ? 'mods' : 'modpacks'} in the catalog yet.`
              : `Nothing matches that search. ${
                  tag === null ? '' : `The ${tag} filter is on — clear it with All.`
                }`}
          </p>
        ) : (
          <ul className="browse-grid">
            {shown.map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                install={install}
                link={linkEntries}
                gameVersion={gameVersion}
                versionUniverse={universe}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export function EntryCard({
  entry,
  install,
  link = true,
  gameVersion = DEFAULT_GAME_VERSION,
  versionUniverse = DEFAULT_UNIVERSE,
}: {
  entry: RegistryEntry;
  install: UseInstall;
  link?: boolean;
  gameVersion?: string;
  /**
   * The version chips expand against the CALLER's universe (the current tab's),
   * because a card alone cannot know which versions exist to be covered — and
   * its chips must match the filter row's, or a card would show a chip the
   * filter never offered. Defaults to the launcher's version alone, for callers
   * with no catalog in hand.
   */
  versionUniverse?: readonly string[];
}): ReactElement {
  const versionNote = gameVersionNote(entry, gameVersion);
  // Chip KINDS, not chip colours: format (what Install runs), person (who made
  // it) and version (which game it covers) all render as the same control with
  // a different weight, so a player scanning a card sorts them without reading.
  const persons = new Set(entryPersons(entry));
  const versions = new Set(entryVersions(entry, versionUniverse));
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
          {link ? (
            <Link href={`/browse/${encodeURIComponent(entry.id)}`} className="entry-name">
              {entry.name}
            </Link>
          ) : (
            <span className="entry-name">{entry.name}</span>
          )}
          <span className="meta">by {entry.author}</span>
        </div>
      </div>
      <p className="entry-summary">{entry.summary}</p>
      <div className="entry-tags">
        {entryTags(entry, versionUniverse).map((t) => (
          // The format chip gets its own class, not a different element: it is
          // the same kind of thing (a tag you can filter by) with a different
          // weight, and a player scanning a grid should be able to see which
          // cards are PML without reading every chip.
          <span
            key={t}
            className={`tag-chip ${t === entry.format ? 'tag-format' : versions.has(t) ? 'tag-version' : persons.has(t) ? 'tag-person' : 'tag-static'}`}
          >
            {t}
          </span>
        ))}
        {entry.safety.touchesPhysics ? (
          <span className="tag-chip tag-warn">
            <Icon name="warn" /> physics
          </span>
        ) : null}
      </div>
      {/* Above the button, not below it: the point is to be read BEFORE the
          click. Derived from gameVersions, so it cannot drift out of step with
          the versions the facts row shows. */}
      {versionNote === null ? null : (
        <p className="install-caveat">
          <Icon name="warn" /> {versionNote}
        </p>
      )}
      <InstallButton entry={entry} install={install} />
    </li>
  );
}
