import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { BrowseList } from '@/components/shell/BrowseList';
import { ShellChrome } from '@/components/shell/ShellChrome';

export const metadata: Metadata = {
  title: 'Browse mods — TSPML',
  description:
    'A curated list of PolyTrack mods and modpacks that run in TSPML. Search, filter by tag, and install into your mod library.',
};

export default function BrowsePage(): ReactElement {
  return (
    <ShellChrome active="browse">
      <BrowseList />
    </ShellChrome>
  );
}
