'use client';

import { useState, type ReactElement } from 'react';
import { Icon } from '@/app/icons';
import {
  installBlockedReason,
  installCaveat,
  installCaveatSummary,
  type RegistryEntry,
} from '@/lib/registry';
import type { UseInstall } from './useInstall';

/**
 * The install control, with its confirm step.
 *
 * The confirm is NOT ceremony. Mod code runs unsandboxed in the same origin as
 * the game and this portal, by design — that is the trade TSPML makes for
 * letting a mod do anything the game can. The paste form discloses it, and an
 * install from a curated list has to disclose it in the same breath, because the
 * curation is ours and the code is not: an entry points at a URL whose contents
 * can change after review.
 *
 * One click reveals what is about to happen, the second does it. That is enough
 * friction to be read and little enough to not be dismissed as a habit.
 *
 * A blocked entry (an unimportable URL, or a format this build cannot run)
 * shows the REASON in place of the button rather than a greyed-out control. A
 * disabled button with no explanation is the thing this design keeps refusing
 * to ship.
 *
 * A PML entry is NOT blocked — it installs through the compatibility adapter —
 * but it carries a caveat, shown next to the button rather than behind the
 * confirm. The confirm is about trust and gets dismissed by habit; "half of
 * this mod's patching will be refused" is a fact about what you are getting,
 * and has to be readable without clicking anything.
 */
export function InstallButton({
  entry,
  install,
}: {
  entry: RegistryEntry;
  install: UseInstall;
}): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const state = install.states[entry.id] ?? { phase: 'idle' as const };

  // Origin is read at click time in the hook; here it is only for the message,
  // and on the server there is no window — so the format half is checked with a
  // placeholder origin that cannot change the format verdict.
  const origin = typeof window === 'undefined' ? 'https://tspml.invalid' : window.location.origin;
  const blocked = installBlockedReason(entry, origin);
  if (blocked !== null) {
    return (
      <p className="install-blocked">
        <Icon name="warn" /> {blocked}
      </p>
    );
  }

  // Stated before the install and kept after it: what the adapter cannot carry
  // across does not stop being true once the mod is in the pool.
  //
  // EXPANDABLE, as a native <details>: the one-line summary is the fact a
  // player deciding needs, and the paragraph is the reasoning. Collapsed by
  // default because this caveat appears on every PML card in the grid — a
  // paragraph repeated nineteen times is wallpaper by the third card, while a
  // one-liner with a visible expander keeps being read. Native details keeps
  // the open path zero-JS (the #118 lesson) and keyboard-accessible for free.
  const caveat = installCaveat(entry);
  const caveatSummary = installCaveatSummary(entry);
  const caveatNote =
    caveat === null || caveatSummary === null ? null : (
      <details className="install-caveat install-caveat-expandable">
        <summary>
          <Icon name="warn" /> {caveatSummary}
        </summary>
        <p>{caveat}</p>
      </details>
    );

  if (state.phase === 'done') {
    return (
      <>
        <p className="install-done">
          <Icon name="check" /> {state.message}
        </p>
        {caveatNote}
      </>
    );
  }

  return (
    <div className="install-box">
      {caveatNote}
      {state.phase === 'error' ? (
        <p className="install-error">
          <Icon name="error" /> {state.message}
        </p>
      ) : null}
      {confirming ? (
        <>
          <p className="install-warn">
            <Icon name="warn" /> Mods run unsandboxed: this code gets the same access to your
            browser as the game and this page. Install only what you trust. TSPML lists this
            entry, but does not review the code behind it, and the code at that URL can change
            after it was listed.
          </p>
          <div className="install-actions">
            <button
              type="button"
              className="btn btn-play"
              disabled={state.phase === 'busy'}
              onClick={() => {
                void install.install(entry);
                setConfirming(false);
              }}
            >
              {state.phase === 'busy' ? (
                <>
                  <Icon name="spinner" className="icon-spin" /> Installing
                </>
              ) : (
                <>
                  <Icon name="plus" /> Install anyway
                </>
              )}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-play"
          disabled={state.phase === 'busy'}
          onClick={() => setConfirming(true)}
        >
          {state.phase === 'busy' ? (
            <>
              <Icon name="spinner" className="icon-spin" /> Installing
            </>
          ) : (
            <>
              <Icon name="plus" /> Install
            </>
          )}
        </button>
      )}
    </div>
  );
}
