'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { Icon } from '@/app/icons';
import { DEFAULT_GAME_VERSION } from '@/lib/game-versions';
import { INSTANCE_LIMITS } from '@/lib/instances';
import type { Instance } from '@/lib/instances';
import { VersionPicker } from './VersionPicker';
import { useInstances } from './useInstances';

/** `2026-08-24T…` → `Aug 24`. Empty input reads as unknown, not as epoch. */
function shortDate(iso: string | undefined): string {
  if (iso === undefined || iso === '') return 'never';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'never';
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function InstanceCard({ instance }: { instance: Instance }): ReactElement {
  return (
    <li className="inst-card">
      <Link className="inst-card-link" href={`/instance/${instance.id}`}>
        <span className="inst-name">{instance.name}</span>
        <code className="inst-version">{instance.gameVersion}</code>
      </Link>
      <p className="meta">last played {shortDate(instance.lastPlayedAt)}</p>
      <div className="row-buttons">
        <Link className="btn btn-small btn-play" href={`/play?instance=${instance.id}`}>
          <Icon name="play" /> Play
        </Link>
        <Link className="btn btn-small" href={`/instance/${instance.id}`}>
          Manage
        </Link>
      </div>
    </li>
  );
}

/**
 * The launcher's landing surface: your instances, and a way to make another.
 *
 * The first thing a visitor sees is their own instances rather than a pitch —
 * that is the launcher premise, and it is why `/` is not a marketing page.
 *
 * A cold profile is not empty here: `readInstances` synthesizes a single
 * `Default` instance for anyone with nothing stored, so this surface always has
 * at least one card and Play is always one click from the front door. Nothing
 * is written until a real mutation, so the visit itself leaves no trace.
 */
export function InstanceGrid(): ReactElement {
  const { store, ready, persistFailed, create } = useInstances();
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftVersion, setDraftVersion] = useState(DEFAULT_GAME_VERSION);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const result = create(draftName, draftVersion);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraftName('');
    setDraftVersion(DEFAULT_GAME_VERSION);
    setCreating(false);
  };

  return (
    <section className="shell-section">
      <div className="section-head">
        <h2>Instances</h2>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            setCreating((c) => !c);
            setError(null);
          }}
        >
          <Icon name={creating ? 'close' : 'plus'} /> {creating ? 'Cancel' : 'New instance'}
        </button>
      </div>
      <p className="meta">
        An instance is a named launch profile: a name, a game version, and which
        of your mods are switched on. All instances share one mod library —
        adding a mod in one makes it available to all of them, and deleting an
        instance deletes no mods.
      </p>

      {creating ? (
        <div className="inst-new">
          <label className="add-label" htmlFor="inst-name">
            <span className="field-tag req">required</span> Name
          </label>
          <input
            id="inst-name"
            className="add-input"
            value={draftName}
            maxLength={INSTANCE_LIMITS.maxNameChars}
            placeholder="Speedrun setup"
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          <label className="add-label" htmlFor="inst-version">
            Game version
          </label>
          <VersionPicker id="inst-version" value={draftVersion} onChange={setDraftVersion} />
          {error ? (
            <p className="warn">
              <Icon name="error" /> {error}
            </p>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={submit}>
            Create instance
          </button>
        </div>
      ) : null}

      {persistFailed ? (
        <p className="warn">
          <Icon name="warn" /> Could not save to this browser&rsquo;s storage. Your
          instances work for this session but will not survive a reload.
        </p>
      ) : null}

      {/* `ready` and not `instances.length`: the pre-read store already holds
          one synthesized instance, so a length check would confidently render
          "you have one instance called Default" to someone who has six. */}
      {ready ? (
        <ul className="inst-grid">
          {store.instances.map((i) => (
            <InstanceCard key={i.id} instance={i} />
          ))}
        </ul>
      ) : (
        <ul className="inst-grid" aria-hidden="true">
          <li className="inst-card inst-card-skeleton" />
        </ul>
      )}
    </section>
  );
}
