import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: {
    template: '%s | EcoRouter Docs',
    default: 'EcoRouter Docs',
  },
  description:
    'EcoRouter: deterministic capability-based purchasing for autonomous agents on Stellar.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="flex min-h-screen flex-col">
        <RootProvider
          theme={{ forcedTheme: 'light', enableSystem: false }}
          search={{ options: { type: 'static', api: '/docs/api/search' } }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
