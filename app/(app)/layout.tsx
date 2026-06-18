'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { FundProvider, useFund } from '@/components/FundProvider';
import { Header } from '@/components/Header';
import { FundContextBar } from '@/components/FundContextBar';
import { Tabs } from '@/components/Tabs';
import { Footer } from '@/components/Footer';

// Inner shell that reads from FundProvider context
function AppShell({ children }: { children: React.ReactNode }) {
  const { scheme, period, selectScheme, selectPeriod, token } = useFund();
  const [strip, setStrip] = useState(true);

  return (
    <div className="min-h-screen flex flex-col bg-page">
      {strip && (
        <div className="bg-ink text-fg-inverse">
          <div className="max-w-[1400px] 2xl:max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 h-8 flex items-center justify-center relative">
            <span className="font-mono text-[10px] tracking-meta uppercase text-white/75 text-center truncate">
              Monthly portfolio disclosure <span className="text-white/40">·</span> Not investment advice{' '}
              <span className="text-white/40">·</span> Verify against the official factsheet
            </span>
            <button
              onClick={() => setStrip(false)}
              className="absolute right-4 text-white/50 hover:text-white"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      <div className="sticky top-0 z-30 bg-card border-b border-line-subtle">
        <Header scheme={scheme} />
        <div className="border-t border-line-subtle">
          <div className="max-w-[1400px] 2xl:max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12">
            <FundContextBar
              scheme={scheme}
              period={period}
              onSelectScheme={selectScheme}
              onSelectPeriod={selectPeriod}
              token={token}
            />
          </div>
        </div>
        <div className="border-t border-line-subtle bg-card">
          <div className="max-w-[1400px] 2xl:max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12">
            <Tabs />
          </div>
        </div>
      </div>

      <main className="flex-1 w-full">
        <div className="max-w-[1400px] 2xl:max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 py-6 sm:py-8">
          {children}
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FundProvider>
      <AppShell>{children}</AppShell>
    </FundProvider>
  );
}
