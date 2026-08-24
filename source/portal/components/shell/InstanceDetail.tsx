'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Icon } from '@/app/icons';
import { findInstance, INSTANCE_LIMITS, isDisabledInInstance } from '@/lib/instances';
import { readUserMods, userModId } from '@/lib/user-mods';
import type { UserModRecord } from '@/lib/user-mods';
import { IconPicker } from './IconPicker';
import { InstanceTile } from './InstanceTile';
import { useInstances } from './useInstances';

/**
 * One instance: its version, which of the shared library's mods it runs, and
 * the three things you can do to it (play, rename, delete).
 *
 * ## What this page can and cannot change about a mod
 *
 * Mods live in one shared pool (`tspml.userMods.v1`) that every instance
 * overlays. This page writes the OVERLAY — which mods this instance skips —
 * and never the pool. So there is no add, no remove, and no library-wide
 * enable here: those all change what every other instance sees, and they
 * belong where the mod itself is managed, on the play page. The copy has to
 * keep the two apart, because "off" meaning two different things one line
 * apart is the confusion this whole model risks.
 *
 * A mod the LIBRARY has switched off renders as such and offers no per-instance
 * control: both switches must agree for a mod to run, so a toggle here would
 * promise something it cannot deliver.
 *
 * Deleting an instance deletes NO mods, and the confirm has to say so out loud:
 * the pool is shared, so "delete" is a smaller act than the word suggests.
 */
export function InstanceDetail({ id }: { id: string }): ReactElement {
  const { store, ready, persistFailed, rename, setIcon, remove, setModDisabled } = useInstances();
  const [mods, setMods] = useState<UserModRecord[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingIcon, setEditingIcon] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // The mod pool, like the instance store, is localStorage and so is read on
  // mount rather than during render. null means "not read yet", which is a
  // different thing from [] and must not render as "no mods".
  useEffect(() => {
    setMods(readUserMods());
  }, []);

  const instance = ready ? findInstance(store, id) : null;

  if (ready && instance === null) {
    return (
      <section className="shell-section">
        <h2>No such instance</h2>
        <p className="meta">
          <code>{id}</code> is not in this browser. It may have been deleted, or
          the link may have come from a different browser — instances are stored
          locally and are not shared between devices.
        </p>
        <Link className="btn btn-small" href="/">
          Back to instances
        </Link>
      </section>
    );
  }

  if (!ready || instance === null) {
    return (
      <section className="shell-section">
        <p className="meta">Loading…</p>
      </section>
    );
  }

  const submitRename = (): void => {
    const result = rename(instance.id, draftName);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setRenaming(false);
  };

  return (
    <section className="shell-section">
      <div className="section-head inst-head">
        <InstanceTile name={instance.name} icon={instance.icon ?? null} size={52} />
        <h2>{instance.name}</h2>
        <code className="inst-version">{instance.gameVersion}</code>
      </div>

      <div className="row-buttons inst-actions">
        <Link className="btn btn-primary btn-play" href={`/play?instance=${instance.id}`}>
          <Icon name="play" /> Play
        </Link>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            setRenaming((r) => !r);
            setDraftName(instance.name);
            setError(null);
          }}
        >
          <Icon name="pencil" /> Rename
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => setEditingIcon((e) => !e)}
        >
          <Icon name="image" /> Picture
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => setConfirmingDelete((c) => !c)}
        >
          <Icon name="trash" /> Delete
        </button>
      </div>

      {renaming ? (
        <div className="inst-new">
          <label className="add-label" htmlFor="inst-rename">
            New name
          </label>
          <input
            id="inst-rename"
            className="add-input"
            value={draftName}
            maxLength={INSTANCE_LIMITS.maxNameChars}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
            }}
          />
          {error ? (
            <p className="warn">
              <Icon name="error" /> {error}
            </p>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={submitRename}>
            Save
          </button>
        </div>
      ) : null}

      {/* Unlike the create dialog's draft, this writes through on every change:
          the instance already exists, so there is nothing to submit and a Save
          button would only invite someone to close the panel without pressing
          it. `setIcon` no-ops when nothing actually changed. */}
      {editingIcon ? (
        <div className="inst-new">
          <IconPicker
            name={instance.name}
            value={instance.icon ?? null}
            onChange={(icon) => setIcon(instance.id, icon)}
          />
        </div>
      ) : null}

      {confirmingDelete ? (
        <div className="inst-new">
          <p className="meta">
            Delete <strong>{instance.name}</strong>? This removes the instance
            only. <strong>No mods are deleted</strong> — your mod library is
            shared between instances and stays exactly as it is.
          </p>
          <div className="row-buttons">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                remove(instance.id);
                setConfirmingDelete(false);
              }}
            >
              <Icon name="trash" /> Delete instance
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {persistFailed ? (
        <p className="warn">
          <Icon name="warn" /> Could not save to this browser&rsquo;s storage. The
          change works for this session but will not survive a reload.
        </p>
      ) : null}

      <h3 className="inst-subhead">Mods</h3>
      <p className="meta">
        Your mod library is shared by every instance; this page picks which of
        them <strong>{instance.name}</strong> runs. Adding and removing mods, and
        switching one off for every instance at once, happen on the play page.
      </p>
      {mods === null ? (
        <p className="meta">Loading…</p>
      ) : mods.length === 0 ? (
        <p className="meta empty-note">
          No mods yet. Open <Link href={`/play?instance=${instance.id}`}>Play</Link>{' '}
          and add one by paste or URL.
        </p>
      ) : (
        <ul className="rows inst-mods">
          {mods.map((m, n) => {
            const modId = userModId(m);
            const offHere = isDisabledInInstance(instance, modId);
            const running = m.enabled && !offHere;
            return (
              <li key={modId ?? `row-${n}`}>
                <div className="row-head">
                  <code>{modId ?? '(no id)'}</code>
                  <span className={running ? 'status-pill pill-on' : 'status-pill pill-off'}>
                    {m.enabled ? (offHere ? 'skipped here' : 'on') : 'off in library'}
                  </span>
                </div>
                {/* No control for a library-disabled mod (it would not run
                    whatever this said) and none for a mod with no manifest id
                    (the overlay addresses mods by id and cannot name it). */}
                {m.enabled && modId !== null ? (
                  <div className="row-buttons">
                    <button
                      type="button"
                      className="btn btn-small btn-instance-toggle"
                      title={
                        offHere
                          ? `Run this mod in ${instance.name} again`
                          : `Stop running this mod in ${instance.name}. It stays in your library and keeps running in your other instances.`
                      }
                      onClick={() => setModDisabled(instance.id, modId, !offHere)}
                    >
                      {offHere ? 'use in this instance' : 'skip in this instance'}
                    </button>
                  </div>
                ) : (
                  <p className="meta">
                    {modId === null
                      ? 'No id in its manifest, so it cannot be switched per instance.'
                      : 'Switched off in your library, so it runs in no instance. Turn it back on from the play page.'}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
