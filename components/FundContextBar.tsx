'use client';

import { SchemeSearch } from './SchemeSearch';
import { PeriodPicker } from './PeriodPicker';
import type { SchemeSummary } from '@/lib/types';

export function FundContextBar({
  scheme,
  period,
  onSelectScheme,
  onSelectPeriod,
  token,
}: {
  scheme: SchemeSummary | null;
  period: string | null;
  onSelectScheme: (s: SchemeSummary) => void;
  onSelectPeriod: (p: string) => void;
  token: string | null;
}) {
  return (
    <div className="flex items-center gap-2 sm:gap-3 py-3 flex-wrap">
      <span className="hidden md:inline font-mono text-[10px] tracking-wide2 uppercase text-fg-secondary shrink-0">
        Context
      </span>
      <SchemeSearch scheme={scheme} onSelect={onSelectScheme} />
      <PeriodPicker scheme={scheme} period={period} onSelect={onSelectPeriod} token={token} />
    </div>
  );
}
