import { redirect } from 'next/navigation';

/**
 * `/` forwards to the play surface, which now lives at `/play`.
 *
 * This is a waypoint, not the destination: `/` becomes the launcher (instances,
 * versions, browse) in the next slice. Landing the file move on its own, behind
 * a redirect, means the entire smoke suite proves the moved component without a
 * single smoke file being edited — so if something breaks after `/` stops
 * redirecting, it is unambiguously routing rather than the move.
 *
 * The query string is forwarded deliberately and is the whole reason this is not
 * a one-liner. `redirect()` sends exactly the path it is given, so a bare
 * `redirect('/play')` would silently drop the params — and `?mods=<url>` share
 * links already exist in the wild. Dropping those would turn a shared mod set
 * into a plain visit to the portal, with no error to explain where the mods
 * went. The play page strips `mods` from the address bar itself once it has
 * read it, so the param does not survive past the first render.
 */
export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    // A repeated param (`?mods=a&mods=b`) arrives as an array and has to be
    // re-appended per value — `mods` is repeatable by design.
    if (Array.isArray(value)) for (const v of value) qs.append(key, v);
    else qs.append(key, value);
  }
  const query = qs.toString();
  redirect(query === '' ? '/play' : `/play?${query}`);
}
