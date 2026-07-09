'use client';

import { useRouter } from 'next/navigation';
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
  const router = useRouter();

  return (
    <div className="flex items-center gap-2 sm:gap-3 py-3 flex-wrap">
      <SchemeSearch
        scheme={scheme}
        onSelect={(s) => {
          onSelectScheme(s);
          // A default period auto-selects the moment a scheme is set
          // (FundProvider's fetchPeriods effect) — go straight to Analyse
          // instead of waiting for the user to also open the month picker.
          router.push('/');
        }}
      />
      {scheme && <PeriodPicker scheme={scheme} period={period} onSelect={onSelectPeriod} token={token} />}
    </div>
  );
}
