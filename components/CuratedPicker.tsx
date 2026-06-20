'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, Layers } from 'lucide-react';
import { fetchSchemeMeta } from '@/lib/client';
import { CURATED } from '@/lib/curated';
import { useFund } from '@/components/FundProvider';
import type { SchemeSummary } from '@/lib/types';

function fmtNav(n: number | null) {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CuratedPicker({
  scheme,
  onSelect,
}: {
  scheme: SchemeSummary | null;
  onSelect: (s: SchemeSummary) => void;
}) {
  const { token } = useFund();
  const [open, setOpen] = useState(false);
  const [funds, setFunds] = useState<SchemeSummary[]>(CURATED);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // enrich with NAV + category on first open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchSchemeMeta(CURATED.map((f) => f.id), token)
      .then((metas) => {
        if (cancelled) return;
        const by = new Map(metas.map((m) => [m.id, m]));
        setFunds(CURATED.map((f) => {
          const m = by.get(f.id);
          return m ? { ...f, nav: m.nav, category: m.category || f.category } : f;
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0" data-testid="curated-picker">
      <button
        onClick={() => setOpen((o) => !o)}
        className={[
          'w-full flex items-center gap-2 h-9 px-3 bg-card border rounded-sm transition-colors text-left',
          open ? 'border-line-focus' : 'border-line-default hover:bg-subtle',
        ].join(' ')}
        style={open ? { boxShadow: '0 0 0 2px var(--border-focus-ring)' } : undefined}
        data-testid="curated-picker-trigger"
      >
        <Layers className="h-4 w-4 text-fg-secondary shrink-0" strokeWidth={2} />
        <span className={['flex-1 min-w-0 truncate text-[16px] sm:text-[13px]', scheme ? 'text-fg-default' : 'text-fg-secondary'].join(' ')}>
          {scheme ? scheme.scheme_name : 'Choose a fund to analyse…'}
        </span>
        <ChevronDown className={['h-4 w-4 text-fg-secondary transition-transform', open ? 'rotate-180' : ''].join(' ')} strokeWidth={2} />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 bg-card border border-line-subtle rounded-sm overflow-hidden anim-fade-up"
          style={{ boxShadow: 'var(--shadow-3)' }}
        >
          <div className="px-3 py-2 border-b border-line-subtle bg-subtle">
            <span className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary">Available funds</span>
          </div>
          <ul className="max-h-72 overflow-y-auto scroll-thin">
            {funds.map((s) => {
              const active = scheme?.id === s.id;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => {
                      onSelect(s);
                      setOpen(false);
                    }}
                    className={[
                      'w-full flex items-center gap-3 px-3 py-2.5 text-left border-l-2 transition-colors',
                      active ? 'bg-tint-info border-primary' : 'border-transparent hover:bg-subtle',
                    ].join(' ')}
                    data-testid={`curated-option-${s.id}`}
                  >
                    <Check className={['h-3.5 w-3.5 text-primary shrink-0', active ? 'opacity-100' : 'opacity-0'].join(' ')} strokeWidth={2.5} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-fg-primary truncate">{s.scheme_name}</div>
                      <div className="font-mono text-[11px] text-fg-secondary truncate">
                        {s.amc_name} <span className="text-fg-disabled">·</span> {s.category}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-[12px] text-fg-default tabular-nums">₹{fmtNav(s.nav)}</div>
                      <div className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary">NAV</div>
                    </div>
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
