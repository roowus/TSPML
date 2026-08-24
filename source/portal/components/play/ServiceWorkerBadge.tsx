'use client';

import type { ReactElement } from 'react';
import { Icon } from '@/app/icons';
import type { SwState } from './types';

/**
 * The topbar's service-worker state light.
 *
 * Worth showing at all because the SW is the load-bearing piece a visitor
 * cannot see: until it CONTROLS the page the game cannot boot, and the gap is
 * long enough to look like nothing is happening. Naming the state turns a
 * blank stage into a wait with a reason.
 */
export function ServiceWorkerBadge({
  state,
  error,
}: {
  state: SwState;
  error: string | null;
}): ReactElement {
  const label =
    state === 'active'
      ? 'ready'
      : state === 'registering'
        ? 'starting…'
        : state === 'error'
          ? 'service worker unavailable'
          : 'waiting…';
  const color = state === 'active' ? 'var(--green)' : state === 'error' ? 'var(--red)' : 'var(--amber)';
  return (
    <p className="sw-badge" style={{ color }}>
      <Icon name="dot" /> {label}
      {error ? <span className="sw-error"> — {error}</span> : null}
    </p>
  );
}
