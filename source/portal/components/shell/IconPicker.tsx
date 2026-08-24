'use client';

import { useId, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { Icon } from '@/app/icons';
import { ICON_ACCEPT, fileToInstanceIcon, instanceIconFromUrl } from '@/lib/instance-icon';

import { InstanceTile } from './InstanceTile';

/**
 * Choose an instance's picture: upload a file, or paste a URL.
 *
 * ## Why both routes, and why upload is first
 *
 * Upload is the one that works with what people actually have — a screenshot, a
 * saved image, a photo. It is listed first for that reason. Pasting a URL is
 * second because it needs the image to already be hosted somewhere, which is a
 * precondition most people cannot satisfy on demand; it earns its place because
 * a URL costs the store almost nothing and skips the downscale entirely (see
 * `lib/instance-icon.ts` on why an upload cannot).
 *
 * ## Errors are shown, never swallowed
 *
 * Every refusal path in `lib/instance-icon.ts` returns a REASON rather than
 * throwing, and this component's only job on the failure side is to put that
 * sentence on screen. A picker that silently does nothing when handed a HEIC
 * reads as broken software; one that says "that image couldn't be decoded — try
 * a PNG, JPEG, or WebP" is a fixable situation.
 *
 * The component is CONTROLLED and stores nothing itself: it hands the caller a
 * validated string (or null to clear) and the caller decides whether that is a
 * draft in a create dialog or an immediate write to an existing instance. That
 * split is why the same control serves both without a mode flag.
 */
export function IconPicker({
  name,
  value,
  onChange,
  busyLabel,
}: {
  /** The instance's name, for the letter fallback in the live preview. */
  name: string;
  value: string | null;
  onChange: (icon: string | null) => void;
  /** Optional label for the field group, when the default is not specific enough. */
  busyLabel?: string;
}): ReactElement {
  const urlFieldId = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const pickFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    // Resetting the input's value is what makes picking the SAME file twice
    // fire a change event again — without it, a failed decode followed by a
    // retry on the identical file would look like the button had stopped working.
    e.target.value = '';
    if (file === undefined) return;
    setWorking(true);
    setError(null);
    const result = await fileToInstanceIcon(file);
    setWorking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChange(result.icon);
  };

  const applyUrl = (): void => {
    const result = instanceIconFromUrl(draftUrl);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraftUrl('');
    onChange(result.icon);
  };

  return (
    <div className="icon-picker">
      <div className="icon-picker-head">
        <InstanceTile name={name} icon={value} size={56} />
        <div className="icon-picker-controls">
          <p className="add-label">{busyLabel ?? 'Picture'}</p>
          <div className="row-buttons">
            <button
              type="button"
              className="btn btn-small"
              disabled={working}
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="image" /> {working ? 'Resizing…' : 'Upload'}
            </button>
            {value === null ? null : (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setError(null);
                  onChange(null);
                }}
              >
                <Icon name="close" /> Remove
              </button>
            )}
          </div>
          {/* Hidden and driven by the button above: a bare file input cannot be
              styled to match anything, and its native label ("No file chosen")
              is wrong here — the preview tile is what says whether one is set. */}
          <input
            ref={fileRef}
            type="file"
            className="icon-file"
            accept={ICON_ACCEPT}
            onChange={(e) => {
              void pickFile(e);
            }}
          />
        </div>
      </div>

      <label className="add-label" htmlFor={urlFieldId}>
        …or paste an image URL
      </label>
      <div className="icon-url-row">
        <input
          id={urlFieldId}
          className="add-input"
          value={draftUrl}
          placeholder="https://example.com/icon.png"
          onChange={(e) => setDraftUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // The picker lives inside forms whose Enter means "create the
              // instance". Applying the URL instead, and stopping there, keeps
              // one keystroke from doing two unrelated things.
              e.preventDefault();
              applyUrl();
            }
          }}
        />
        <button type="button" className="btn btn-small" onClick={applyUrl}>
          Use
        </button>
      </div>

      <p className="meta">
        Uploads are resized to 128&nbsp;px and stored in this browser. A URL is
        loaded from wherever it lives, so it changes when that image does.
      </p>

      {error === null ? null : (
        <p className="warn">
          <Icon name="error" /> {error}
        </p>
      )}
    </div>
  );
}
