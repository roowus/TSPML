import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Script from 'next/script';
import { GA_ID } from '@/lib/analytics';
import './globals.css';

/**
 * Site metadata for the beta release. The icon set is file-convention based
 * (app/icon.svg, app/apple-icon.png, app/opengraph-image.png) so Next wires
 * the favicon, apple-touch icon, and OG/Twitter image tags itself;
 * `metadataBase` is what makes the OG image URL absolute on the deploy.
 */
export const metadata: Metadata = {
  metadataBase: new URL('https://tspml.vercel.app'),
  title: 'TSPML: play PolyTrack with mods',
  description:
    'The Skibiti PolyModLoader. Add a mod by paste or URL and play PolyTrack with it in your browser. Mods use a stable API and survive game updates.',
  openGraph: {
    title: 'TSPML: play PolyTrack with mods',
    description:
      'Add a mod by paste or URL and play PolyTrack with it in your browser. Mods use a stable API and survive game updates.',
    url: 'https://tspml.vercel.app',
    siteName: 'TSPML',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TSPML: play PolyTrack with mods',
    description:
      'Add a mod by paste or URL and play PolyTrack with it in your browser.',
  },
};

export const viewport: Viewport = {
  themeColor: '#0b0d12',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Google Analytics 4 — only when NEXT_PUBLIC_GA_ID is set at build
            time. IP anonymization is GA4 default; custom events (mod usage,
            ids only — never code or URLs) live in lib/analytics.ts. */}
        {GA_ID !== '' ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
            </Script>
          </>
        ) : null}
      </body>
    </html>
  );
}
