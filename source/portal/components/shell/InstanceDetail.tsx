'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Icon } from '@/app/icons';
import { findInstance, INSTANCE_LIMITS } from '@/lib/instances';
import { readUserMods, userModId } from '@/lib/user-mods';
import type { UserModRecord } from '@/lib/user-mods';
import { useInstances } from './useInstances';

/**
 * One instance: its version, the mod library it launches with, and the three
 * things you can do to it (play, rename, delete).
 *
 * ## The mod list here is READ-ONLY, and that is the honest rendering
 *
 * Mods live in one shared pool (`tspml.userMods.v1`) that every instance
 * overlays; this page reads that pool so you can see what a launch will load.
 * The per-instance on/off overlay (`disabledModIds`) is reserved in the schema
 * and honored by the resolver, but nothing writes it yet — so showing a toggle
 * here would be a control that silently does nothing. It arrives with the
 * overlay slice. Until then the copy says where mods are actually managed
 * rather than implying this page manages them.
 *
 * Deleting an instance deletes NO mods, and the confirm has to say so out loud:
 * the pool is shared, so "delete" is a smaller act than the word suggests.
 */
export function InstanceDetail({ id }: { id: string }): ReactElement {
  const { store, ready, persistFailed, rename, remove } = useInstances();
  const [mods, setMods] = useState<UserModRecord[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);
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
      <div className="section-head">
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

      <h3 className="inst-subhead">Mod library</h3>
      <p className="meta">
        Shared by every instance. Add, remove, and toggle mods on the play page;
        this list is what a launch will load.
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
          {mods.map((m, n) => (
            <li key={userModId(m) ?? `row-${n}`}>
              <div className="row-head">
                <code>{userModId(m) ?? '(no id)'}</code>
                <span className={m.enabled ? 'status-pill pill-on' : 'status-pill pill-off'}>
                  {m.enabled ? 'on' : 'off'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
