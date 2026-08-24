'use client';

import type { ReactElement } from 'react';
import { GAME_VERSIONS, VERSION_PICKER_NOTE } from '@/lib/game-versions';

/**
 * Pick the PolyTrack build an instance launches.
 *
 * Today exactly one option is selectable, and the honest way to ship that is a
 * real picker whose other options are visibly present and disabled with their
 * reason attached — not a hidden control, and emphatically not a working-looking
 * dropdown that hands back an unmodded game. See `lib/game-versions.ts` for why
 * only 0.6.2 has a symbol map.
 *
 * `disabled` on an `<option>` is honored by every browser's native select, so
 * 0.6.0 is visible-and-unpickable rather than absent. The reason rides in the
 * option's own label because a select collapses to one line: a note placed
 * beside the control is not read by someone who has already opened the list and
 * is wondering why the entry they want will not take.
 */
export function VersionPicker({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  id?: string | undefined;
}): ReactElement {
  return (
    <>
      <select
        id={id}
        className="add-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {GAME_VERSIONS.map((v) => (
          <option key={v.id} value={v.id} disabled={!v.selectable}>
            {v.selectable ? v.id : `${v.id} — ${v.reason}`}
          </option>
        ))}
      </select>
      <p className="meta version-note">{VERSION_PICKER_NOTE}</p>
    </>
  );
}
