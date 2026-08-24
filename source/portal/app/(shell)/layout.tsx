import type { ReactNode } from 'react';

/**
 * Route group for the launcher. The parentheses keep it out of the URL, so
 * `app/(shell)/page.tsx` is still `/`.
 *
 * The group exists so launcher chrome can never mount around the game. `/play`
 * sits outside it and gets its own layout; a shared nav bar would otherwise
 * wrap a running WebGL iframe and share a render pass with it.
 *
 * The chrome itself is per-page rather than here, because each page marks a
 * different nav item current and doing that in the layout would require
 * `usePathname()` — turning the entire frame into a client component to move
 * one underline.
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return children;
}
