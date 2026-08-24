/**
 * Types shared between the play surface and its presentational children.
 *
 * These live here rather than in `app/play/page.tsx` so a component can be
 * imported without dragging the page's module graph (and its `'use client'`
 * session cluster) along with it. Everything here is a plain data shape: no
 * component in `components/play/` owns session state, and none of them reads
 * storage or the network. The page stays the single owner of the game session.
 */

/** Where the service worker is in its registration lifecycle. */
export type SwState = 'idle' | 'registering' | 'active' | 'error';

/** One row in the "Loaded mods" list: the loader's verdict on one mod. */
export interface LoadedModRow {
  id: string;
  status: 'loaded' | 'failed';
  reason?: string;
}
