'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useEmbedToken } from '@/hooks/use-embed-token';
import { fetchPeriods } from '@/lib/client';
import type { SchemeSummary } from '@/lib/types';

interface FundCtx {
  scheme: SchemeSummary | null;
  period: string | null;
  selectScheme: (s: SchemeSummary) => void;
  selectPeriod: (p: string) => void;
  /** Set scheme + period together (e.g. after an upload) without the auto-period override. */
  selectUploaded: (s: SchemeSummary, period: string) => void;
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
  // When set, the next scheme-change effect uses this period instead of auto-picking.
  const lockedPeriod = useRef<string | null>(null);

  // On scheme (or token) change, choose a sensible default period — unless an
  // explicit period was locked in by selectUploaded.
  useEffect(() => {
    if (!scheme) {
      setPeriod(null);
      return;
    }
    if (lockedPeriod.current) {
      setPeriod(lockedPeriod.current);
      lockedPeriod.current = null;
      return;
    }
    let cancelled = false;
    fetchPeriods(scheme.id, token)
      .then((ps) => {
        if (cancelled) return;
        const preferred = ps.find((p) => p.status === 'ready') ?? ps.find((p) => p.status === 'fetchable') ?? ps[0] ?? null;
        setPeriod(preferred ? preferred.period : null);
      })
      .catch(() => {
        /* leave period as-is */
      });
    return () => {
      cancelled = true;
    };
  }, [scheme, token]);

  function selectScheme(s: SchemeSummary) {
    setScheme(s);
  }
  function selectPeriod(p: string) {
    setPeriod(p);
  }
  function selectUploaded(s: SchemeSummary, p: string) {
    lockedPeriod.current = p;
    setScheme(s);
    setPeriod(p);
  }

  return (
    <FundContext.Provider value={{ scheme, period, selectScheme, selectPeriod, selectUploaded, token }}>
      {children}
    </FundContext.Provider>
  );
}
