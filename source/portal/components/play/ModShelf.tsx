'use client';

import { useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Icon } from '@/app/icons';
import { userModDocs, userModHomepage, userModIcon, userModId } from '@/lib/user-mods';
import type { UserModRecord } from '@/lib/user-mods';
import { ModTile } from './ModTile';

/**
 * The mod shelf: your library, as a shelf of switches rather than a stack of
 * cards.
 *
 * ## What changed, and why
 *
 * The old "Your mods" list gave every mod a card with six buttons on it
 * (source, disable, skip here, remove, docs, site) and three lines of text
 * including a full URL. Six mods meant thirty-six buttons, and the two that
 * matter — is this mod on, and is it on HERE — were the least visually
 * distinct of them. The shelf inverts that:
 *
 * - **One line per mod by default.** Tile, id, state, facts. Everything a
 *   scan needs and nothing it does not.
 * - **The switches lead.** The library switch and the per-instance switch sit
 *   together in the row; the reference material (where it came from, its
 *   docs, its stored source) is behind a per-row `details` disclosure.
 * - **Selection, for the "turn it all off" moment.** Testing whether a mod is
 *   what broke the game means switching several off at once, which used to be
 *   one click per mod per direction. Checkboxes appear once there are two mods
 *   to compare.
 * - **Remove is undoable rather than confirmed.** A modal on a destructive
 *   action is the usual answer, but this action is cheap to reverse and
 *   expensive to interrupt: the record is right here in memory, so the shelf
 *   takes the mod out immediately and offers it back for as long as the notice
 *   is up. That is a better trade than a dialog on every single removal.
 *
 * ## Contracts this component is not free to change
 *
 * The headless smokes are the only proof any of this UI works (vitest runs in
 * `node`, so there is no DOM unit test anywhere), and they read this subtree
 * by structure and by button label:
 *
 * - A row's FIRST `<span>` must be the status pill. Hence `ModTile` is an
 *   `<i>`, the row body is a `<div>`, and the select checkbox is an `<input>`.
 * - Inside a row, `button:has-text("remove")` and `button:has-text("disable")`
 *   must each resolve and must each act in ONE click. No confirm step, and no
 *   hiding either one behind the disclosure.
 * - `"use in this instance"` / `"skip in this instance"` are matched
 *   unscoped and counted, so exactly one row may offer one at a time in the
 *   smokes' single-mod library — and the labels must stay spelled out.
 * - No `<details>` element anywhere in here. The Add form is a popover now and
 *   carries no `<summary>`; the Log section's details (Diagnostics tab) is the
 *   aside's only one, and nothing may precede it blind-clicking.
 * - The undo notice must not be an `<li>` carrying a `<code>` of the removed
 *   id: `smoke-user-mods` proves a removed row is gone by looking for exactly
 *   that shape.
 */
export interface ModShelfProps {
  /** The library, in storage order. */
  mods: readonly UserModRecord[];
  /** The instance being played, if any — names the per-instance switch. */
  instanceName: string | null;
  /** Whether this instance's overlay switches the given mod off. */
  isOffHere: (modId: string | null) => boolean;
  /** Flip the LIBRARY switch (`record.enabled`) on one mod. */
  onSetEnabled: (mods: readonly UserModRecord[], enabled: boolean) => void;
  /** Flip THIS INSTANCE's overlay for one mod. */
  onSetOffHere: (modId: string, offHere: boolean) => void;
  /** Delete records from the library. */
  onRemove: (mods: readonly UserModRecord[]) => void;
  /** Put removed records back (the undo notice). */
  onRestore: (mods: readonly UserModRecord[]) => void;
  /** Build a share link for the running set. */
  onShare: () => void;
  /** Re-fetch URL-imported mods and reload the set. */
  onReload: () => void;
  reloadBusy: boolean;
  /** Share panel, share/reload notices — rendered between header and list. */
  notices?: ReactNode;
}

/** Below this many mods a filter field is furniture, not help. */
const FILTER_FROM = 4;
/** Below two mods there is nothing to select between. */
const SELECT_FROM = 2;

/** The host of a source URL, for the one-line facts. Full URL lives in details. */
function sourceHost(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function ModShelf({
  mods,
  instanceName,
  isOffHere,
  onSetEnabled,
  onSetOffHere,
  onRemove,
  onRestore,
  onShare,
  onReload,
  reloadBusy,
  notices,
}: ModShelfProps): ReactElement {
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  // The records themselves, not their ids: undo has to put back the code, and
  // the record is gone from the library the moment remove is clicked.
  const [undoable, setUndoable] = useState<readonly UserModRecord[] | null>(null);

  // Row identity: the manifest id where there is one, a positional stand-in
  // where there is not. A mod with no id cannot be addressed by the instance
  // overlay either, which the row says out loud.
  const rows = useMemo(
    () =>
      mods.map((mod, i) => {
        const modId = userModId(mod);
        const id = modId ?? `(no id #${i + 1})`;
        const offHere = isOffHere(modId);
        return { mod, modId, id, offHere, running: mod.enabled && !offHere };
      }),
    [mods, isOffHere],
  );

  const needle = filter.trim().toLowerCase();
  const shown = needle.length === 0 ? rows : rows.filter((r) => r.id.toLowerCase().includes(needle));

  const runningCount = rows.filter((r) => r.running).length;
  const selectable = rows.length >= SELECT_FROM;
  const picked = rows.filter((r) => selected.includes(r.id));

  const toggleSelected = (id: string): void => {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const remove = (targets: readonly { mod: UserModRecord; id: string }[]): void => {
    if (targets.length === 0) return;
    const records = targets.map((t) => t.mod);
    setOpenId(null);
    setSelected((cur) => cur.filter((x) => !targets.some((t) => t.id === x)));
    setUndoable(records);
    onRemove(records);
  };

  return (
    <>
      <div className="section-head shelf-head">
        <h2>Your mods</h2>
        <span className="row-buttons">
          {/* The Add-a-mod opener: a real button opening a native popover via
              `popovertarget` — zero JS in the open path, so it works before
              hydration exactly like the #118 controls inside the form it
              reveals. Primary styling: adding a mod is THE action this shelf
              exists for, not a third small text button. */}
          {/* Label says "Add a mod", NOT "Add mod": the smokes click the
              form's submit with `button:has-text("Add mod")`, which is a
              SUBSTRING match that would hit this opener first if this also
              said "Add mod" — toggling the popover shut instead of
              submitting. The two labels must stay one word apart. */}
          <button type="button" className="btn btn-primary btn-small add-opener" popoverTarget="add-mod-popover">
            <Icon name="plus" /> Add a mod
          </button>
          {/* Reload = re-fetch URL-imported mods from their source, then re-run
              the whole set through the loader. Entrypoint changes apply live;
              mixin changes raise the restart banner as usual. Rendered only with
              mods present — a reload of nothing is noise, and the smokes'
              empty-store boot stays button-free. Share likewise needs something
              to share. */}
          {mods.length > 0 ? (
            <>
              <button
                type="button"
                className="btn btn-small"
                title="Build a link that carries your enabled URL-imported mods (links only, never code) — whoever opens it is asked before anything imports"
                onClick={onShare}
              >
                <Icon name="share" /> share
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={reloadBusy}
                title="Re-fetch URL-imported mods from their source and reload every mod"
                onClick={onReload}
              >
                <Icon name="refresh" className={reloadBusy ? 'icon-spin' : undefined} />{' '}
                {reloadBusy ? 'reloading…' : 'reload'}
              </button>
            </>
          ) : null}
        </span>
      </div>

      {/* The count, as a fact rather than a paragraph. "running here" is the
          number that actually answers "what am I playing", which the old
          header never showed at all. */}
      {mods.length > 0 ? (
        <p className="meta shelf-count">
          {mods.length} mod{mods.length === 1 ? '' : 's'} in your library
          {instanceName === null
            ? null
            : `, ${runningCount} running in ${instanceName}`}
          .
        </p>
      ) : null}

      {/* Said out loud, because it is the one thing about instances that
          surprises people: there is ONE mod library, and an instance is a view
          onto it. Without this line, "skip in this instance" next to "remove"
          reads as two flavours of delete. */}
      {instanceName !== null && mods.length > 0 ? (
        <p className="meta">
          One library, shared by every instance. “skip in this instance” switches a mod off for{' '}
          <strong>{instanceName}</strong> only; “disable” switches it off everywhere and “remove”
          deletes it from the library.
        </p>
      ) : null}

      {notices}

      {/* Removal, taken back. The notice is a <div> and names the mod in a
          <strong>, deliberately: a removed row is proved gone by looking for
          an <li> whose <code> is the id and which still has a button. */}
      {undoable !== null && undoable.length > 0 ? (
        <div className="shelf-undo">
          <span className="shelf-undo-text">
            Removed{' '}
            <strong>
              {undoable.length === 1
                ? (userModId(undoable[0]!) ?? 'a mod with no id')
                : `${undoable.length} mods`}
            </strong>{' '}
            from your library.
          </span>
          <span className="row-buttons">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                const back = undoable;
                setUndoable(null);
                onRestore(back);
              }}
            >
              <Icon name="refresh" /> undo
            </button>
            <button
              type="button"
              className="btn btn-small"
              title="Dismiss"
              onClick={() => setUndoable(null)}
            >
              <Icon name="close" />
            </button>
          </span>
        </div>
      ) : null}

      {mods.length === 0 ? (
        <p className="meta empty-note">
          Nothing on the shelf yet. Add a mod with the button above — paste one
          you are writing, import a URL — or open Browse for the curated list.
        </p>
      ) : (
        <>
          {rows.length >= FILTER_FROM ? (
            <input
              type="search"
              className="add-input shelf-filter"
              placeholder="Filter by id…"
              aria-label="Filter your mods by id"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          ) : null}

          {/* The bulk bar exists for one workflow: switching several mods off
              at once to find which one broke the game. It never offers the
              per-instance switch — that control is counted by name elsewhere,
              and a bulk version of it would be a second thing answering to the
              same label. */}
          {picked.length > 0 ? (
            <div className="shelf-bulk">
              <span className="shelf-bulk-count">{picked.length} selected</span>
              <span className="row-buttons">
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => onSetEnabled(picked.map((p) => p.mod), true)}
                >
                  Turn on
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => onSetEnabled(picked.map((p) => p.mod), false)}
                >
                  Turn off
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  onClick={() => remove(picked)}
                >
                  <Icon name="trash" /> Remove selected
                </button>
                <button type="button" className="btn btn-small" onClick={() => setSelected([])}>
                  Clear
                </button>
              </span>
            </div>
          ) : null}

          {shown.length === 0 ? (
            <p className="meta empty-note">
              No mod id matches “{filter.trim()}”.
            </p>
          ) : (
            <ul className="rows mod-shelf">
              {shown.map(({ mod, modId, id, offHere, running }) => {
                const version =
                  typeof mod.manifest.version === 'string' ? mod.manifest.version : null;
                const homepage = userModHomepage(mod);
                const docs = userModDocs(mod);
                const host = sourceHost(mod.sourceUrl ?? null);
                const open = openId === id;
                const facts = [
                  version === null ? '' : `v${version}`,
                  mod.mixins ? `${mod.mixins.length} mixin${mod.mixins.length === 1 ? '' : 's'}` : '',
                  // Worth its own fact (#43): this is the one thing a mod can
                  // carry that rewrites the physics binary, so "why are my lap
                  // times different" has an answer visible on the shelf.
                  mod.physics ? 'physics patch' : '',
                  host ?? 'pasted',
                ].filter((s) => s.length > 0);
                return (
                  <li key={id} className={running ? 'shelf-row' : 'shelf-row shelf-row-off'}>
                    {/* Checkbox, tile and body are input/<i>/<div> so the
                        row's first <span> stays the status pill. */}
                    {selectable ? (
                      <input
                        type="checkbox"
                        className="shelf-check"
                        checked={selected.includes(id)}
                        aria-label={`Select ${id}`}
                        onChange={() => toggleSelected(id)}
                      />
                    ) : null}
                    <ModTile id={id} icon={userModIcon(mod)} />
                    <div className="shelf-body">
                      <div className="row-head">
                        <code title={id}>{id}</code>
                        <span
                          className={running ? 'status-pill pill-on' : 'status-pill pill-off'}
                          title={
                            mod.enabled
                              ? offHere
                                ? `On in your library, switched off for ${instanceName ?? 'this instance'}`
                                : 'On in your library and in this instance'
                              : 'Switched off in your library, for every instance'
                          }
                        >
                          {mod.enabled ? (offHere ? 'off here' : 'running') : 'off in library'}
                        </span>
                      </div>
                      {facts.length > 0 ? (
                        <div className="meta shelf-facts">{facts.join(' · ')}</div>
                      ) : null}
                      <div className="row-buttons shelf-switches">
                        <button
                          type="button"
                          className="btn btn-small"
                          title={
                            mod.enabled
                              ? 'Switch this mod off in your library — for every instance'
                              : 'Switch this mod on in your library'
                          }
                          onClick={() => onSetEnabled([mod], !mod.enabled)}
                        >
                          {mod.enabled ? 'disable' : 'enable'}
                        </button>
                        {/* The per-instance switch, deliberately NOT merged
                            with the library one beside it. Offered only when
                            there is an instance to scope to and the mod has a
                            manifest id (the overlay is a list of ids and
                            cannot address a mod without one), and only while
                            the library switch is on — a control that promised
                            to turn on a mod the library has off would be
                            lying, since both switches must agree.

                            The label says "this instance" in full rather than
                            pairing "disable"/"off here": the two buttons sit
                            inches apart and do different things, so the
                            expensive mistake is reading one as the other. It
                            also keeps `button:has-text("disable")` — which
                            smoke-user-mods leg 6 clicks to exercise the
                            LIBRARY switch — matching exactly one button. */}
                        {instanceName !== null && modId !== null && mod.enabled ? (
                          <button
                            type="button"
                            className="btn btn-small btn-instance-toggle"
                            title={
                              offHere
                                ? `Run this mod in '${instanceName}' again. Your other instances are unaffected either way.`
                                : `Stop running this mod in '${instanceName}' only. It stays in your library and keeps running in your other instances.`
                            }
                            onClick={() => onSetOffHere(modId, !offHere)}
                          >
                            {offHere ? 'use in this instance' : 'skip in this instance'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-small shelf-more"
                          aria-expanded={open}
                          title="Where this mod came from, its links, and its stored source"
                          onClick={() => setOpenId((cur) => (cur === id ? null : id))}
                        >
                          <Icon name="code" /> {open ? 'less' : 'details'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          title="Delete this mod from your library. You can undo it."
                          onClick={() => remove([{ mod, id }])}
                        >
                          remove
                        </button>
                      </div>

                      {open ? (
                        <div className="shelf-details">
                          {/* Where the mod came from. One line, truncated,
                              full URL in the title — a wrapping URL is what
                              made the old cards unreadable. */}
                          <div
                            className="meta origin"
                            title={
                              mod.sourceUrl ??
                              'Added by pasting — the only copy is this browser’s storage'
                            }
                          >
                            <Icon name="link" />
                            {mod.sourceUrl ? (
                              <a href={mod.sourceUrl} target="_blank" rel="noreferrer">
                                {mod.sourceUrl}
                              </a>
                            ) : (
                              <span className="origin-text">pasted (this browser only)</span>
                            )}
                          </div>
                          {/* "docs" opens the manifest's dedicated `docs` URL —
                              usage documentation, NOT the repo. `homepage`
                              (typically the repo) gets its own honestly-named
                              "site" link. Both helpers return http(s) URLs
                              only, so these anchors can't smuggle a
                              javascript: href out of a pasted manifest. */}
                          {docs !== null || homepage !== null ? (
                            <div className="row-buttons">
                              {docs !== null ? (
                                <a
                                  className="btn btn-small"
                                  href={docs}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={`Open this mod’s documentation: ${docs}`}
                                >
                                  <Icon name="external" /> docs
                                </a>
                              ) : null}
                              {homepage !== null ? (
                                <a
                                  className="btn btn-small"
                                  href={homepage}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={`Open this mod’s site: ${homepage}`}
                                >
                                  <Icon name="external" /> site
                                </a>
                              ) : null}
                            </div>
                          ) : null}
                          {modId === null ? (
                            <p className="meta">
                              No <code>id</code> in its manifest, so it cannot be switched per
                              instance — the overlay addresses mods by id.
                            </p>
                          ) : null}
                          <div className="source-view">
                            <div className="source-label">mod.json</div>
                            <pre className="source-pre">{JSON.stringify(mod.manifest, null, 2)}</pre>
                            <div className="source-label">
                              entrypoint.js ({mod.code.length.toLocaleString()} chars)
                            </div>
                            <pre className="source-pre">{mod.code}</pre>
                            {mod.mixins ? (
                              <>
                                <div className="source-label">mixins.json</div>
                                <pre className="source-pre">
                                  {JSON.stringify(mod.mixins, null, 2)}
                                </pre>
                              </>
                            ) : null}
                            {mod.physics ? (
                              <>
                                <div className="source-label">physics.json</div>
                                <pre className="source-pre">
                                  {JSON.stringify(mod.physics, null, 2)}
                                </pre>
                              </>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
