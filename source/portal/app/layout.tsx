import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'TSPML — Play PolyTrack, modded',
  description:
    'TSPML portal: play PolyTrack with the TSPML mod loader. Proof of concept (M2) — loads the real game through a proxy + service worker.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0b0d12', color: '#e6e8ee' }}>{children}</body>
    </html>
  );
}
