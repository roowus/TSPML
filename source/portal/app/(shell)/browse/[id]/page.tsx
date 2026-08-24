import type { ReactElement } from 'react';
import { EntryDetail } from '@/components/shell/EntryDetail';
import { ShellChrome } from '@/components/shell/ShellChrome';

/**
 * One catalog entry, at a linkable URL.
 *
 * No `generateStaticParams` and no `generateMetadata` reading the catalog: the
 * registry is fetched at RUNTIME through `lib/registry.ts` precisely so a future
 * backend swap changes one constant. Pre-rendering these pages from the JSON
 * would bake today's catalog into the build output and quietly undo that.
 */
export default async function BrowseEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return (
    <ShellChrome active="browse">
      <EntryDetail id={id} />
    </ShellChrome>
  );
}
