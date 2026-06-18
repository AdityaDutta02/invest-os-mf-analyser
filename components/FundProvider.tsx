'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useEmbedToken } from '@/hooks/use-embed-token';
import { fetchPeriods } from '@/lib/client';
import type { SchemeSummary } from '@/lib/types';

interface FundCtx {
  scheme: SchemeSummary | null;
  period: string | null;
  selectScheme: (s: SchemeSummary) => void;
  selectPeriod: (p: string) => void;
  token: string | null;
}

const FundContext = createContext<FundCtx | null>(null);

export function useFund(): FundCtx {
  const ctx = useContext(FundContext);
  if (!ctx) throw new Error('useFund must be used within FundProvider');
  return ctx;
}

export function FundProvider({ children }: { children: React.ReactNode }) {
  const token = useEmbedToken();
  const [scheme, setScheme] = useState<SchemeSummary | null>(null);
  const [period, setPeriod] = useState<string | null>(null);

  // When scheme or token changes, (re)fetch periods and pick the latest with data
  useEffect(() => {
    if (!scheme) {
      setPeriod(null);
      return;
    }
    let cancelled = false;
    fetchPeriods(scheme.id, token).then((ps) => {
      if (cancelled) return;
      const latest = ps.find((p) => p.hasData) ?? ps[0] ?? null;
      setPeriod(latest ? latest.period : null);
    }).catch(() => {
      // tolerate failure — period stays as-is
    });
    return () => { cancelled = true; };
  }, [scheme, token]);

  function selectScheme(s: SchemeSummary) {
    setScheme(s);
    // period will be set by the effect above
  }

  function selectPeriod(p: string) {
    setPeriod(p);
  }

  return (
    <FundContext.Provider value={{ scheme, period, selectScheme, selectPeriod, token }}>
      {children}
    </FundContext.Provider>
  );
}
