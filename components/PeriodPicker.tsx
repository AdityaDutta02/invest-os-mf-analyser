'use client';

import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, Check } from 'lucide-react';
import { fetchPeriods } from '@/lib/client';
import type { SchemeSummary, PeriodOption } from '@/lib/types';

export function PeriodPicker({
  scheme,
  period,
  onSelect,
  token,
}: {
  scheme: SchemeSummary | null;
  period: string | null;
  onSelect: (p: string) => void;
  token: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scheme) {
      setPeriods([]);
      return;
    }
    let cancelled = false;
    fetchPeriods(scheme.id, token)
      .then((ps) => {
        if (!cancelled) setPeriods(ps);
      })
      .catch(() => {
        if (!cancelled) setPeriods([]);
      });
    return () => {
      cancelled = true;
    };
  }, [scheme, token]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const disabled = !scheme;
  const current = periods.find((p) => p.period === period);

  return (
    <div ref={wrapRef} className="relative shrink-0" data-testid="period-picker">
      <button
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={[
          'flex items-center gap-2 h-9 px-3 bg-card border rounded-sm transition-colors focus-ring',
          disabled
            ? 'border-line-muted text-fg-disabled cursor-not-allowed'
            : 'border-line-default text-fg-default hover:bg-subtle',
        ].join(' ')}
      >
        <Calendar className="h-4 w-4 text-fg-secondary" strokeWidth={2} />
        <span className="font-mono text-[12px] tabular-nums min-w-[64px] text-left">
          {current ? current.label : 'Select month'}
        </span>
        <ChevronDown
          className={['h-4 w-4 text-fg-secondary transition-transform', open ? 'rotate-180' : ''].join(' ')}
          strokeWidth={2}
        />
      </button>

      {open && !disabled && (
        <div
          className="absolute right-0 top-[calc(100%+4px)] z-40 w-56 bg-card border border-line-subtle rounded-sm overflow-hidden anim-fade-up"
          style={{ boxShadow: 'var(--shadow-3)' }}
        >
          <div className="px-3 py-2 border-b border-line-subtle bg-subtle">
            <span className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary">Portfolio month</span>
          </div>
          <ul className="py-1">
            {periods.map((p) => {
              const active = p.period === period;
              return (
                <li key={p.period}>
                  <button
                    onClick={() => {
                      onSelect(p.period);
                      setOpen(false);
                    }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-subtle transition-colors"
                    data-testid={`period-option-${p.period}`}
                  >
                    <span className="flex items-center gap-2">
                      <Check
                        className={['h-3.5 w-3.5 text-primary', active ? 'opacity-100' : 'opacity-0'].join(' ')}
                        strokeWidth={2.5}
                      />
                      <span
                        className={[
                          'font-mono text-[12px] tabular-nums',
                          active ? 'text-fg-primary' : 'text-fg-default',
                        ].join(' ')}
                      >
                        {p.label}
                      </span>
                    </span>
                    {p.hasData ? (
                      <span className="font-mono text-[9px] tracking-meta uppercase text-success">data</span>
                    ) : (
                      <span className="font-mono text-[9px] tracking-meta uppercase text-fg-disabled">no data</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
