import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { ShellChrome } from '@/components/shell/ShellChrome';
import { InstanceDetail } from '@/components/shell/InstanceDetail';

export const metadata: Metadata = {
  title: 'Instance — TSPML',
};

/**
 * `/instance/<id>` — one launch profile.
 *
 * The id is a route param rather than storage state so the page is linkable and
 * the back button works, which is the whole reason the launcher uses real
 * routes. Resolution happens on the client: instances live in `localStorage`,
 * so the server cannot know whether this id exists, and an id that resolves to
 * nothing renders an explanation rather than a 404 — "not in this browser" is
 * the accurate diagnosis, and a 404 would wrongly suggest the link is malformed.
 */
export default async function InstancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return (
    <ShellChrome active="instances">
      <InstanceDetail id={id} />
    </ShellChrome>
  );
}
