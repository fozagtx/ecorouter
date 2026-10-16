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
    'EcoRouter: a shared USDC spending account on Stellar for teams and their AI agents. Every spender pays under its own on-chain policy.',
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
