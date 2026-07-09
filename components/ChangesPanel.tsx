'use client';

import { TrendingUp, TrendingDown, Plus, Minus, Info } from 'lucide-react';
import type { CompareData, ChangeRow } from '@/lib/types';

function fmtSigned(n: number, suffix = '%') {
  const s = n > 0 ? '+' : '';
  return `${s}${n.toFixed(2)}${suffix}`;
}

function deltaColor(n: number) {
  return n > 0 ? 'text-success' : n < 0 ? 'text-error' : 'text-fg-secondary';
}

function ChangeRowList({ rows, kind }: { rows: ChangeRow[]; kind: 'added' | 'exited' | 'increased' | 'reduced' }) {
  if (rows.length === 0) return null;
  const label = { added: 'New', exited: 'Exited', increased: 'Increased', reduced: 'Reduced' }[kind];
  const Icon = kind === 'added' ? Plus : kind === 'exited' ? Minus : kind === 'increased' ? TrendingUp : TrendingDown;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={['h-3 w-3', deltaColor(kind === 'exited' || kind === 'reduced' ? -1 : 1)].join(' ')} strokeWidth={2.25} />
        <span className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary">
          {label} ({rows.length})
        </span>
      </div>
      <ul className="space-y-1">
        {rows.slice(0, 8).map((r) => (
          <li key={r.isin || r.name} className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className="text-fg-default truncate">{r.name}</span>
            <span className={['font-mono tabular-nums shrink-0', deltaColor(r.delta)].join(' ')}>{fmtSigned(r.delta)}</span>
          </li>
        ))}
        {rows.length > 8 && (
          <li className="text-[11px] text-fg-secondary font-mono">+{rows.length - 8} more</li>
        )}
      </ul>
    </div>
  );
}

export function ChangesPanel({ compare, fromLabel, toLabel }: { compare: CompareData; fromLabel: string; toLabel: string }) {
  const { kpis, changes, category_drift } = compare;
  const hasAnyChanges =
    changes.added.length + changes.exited.length + changes.increased.length + changes.reduced.length > 0;

  return (
    <section className="bg-card border border-line-default rounded-sm h-full flex flex-col" data-testid="changes-panel">
      <div className="flex items-center gap-2.5 px-3 h-9 border-b border-line-subtle shrink-0">
        <span className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary">
          Changes <span className="text-fg-disabled">{fromLabel} → {toLabel}</span>
        </span>
      </div>

      <div className="p-3 space-y-4 overflow-y-auto scroll-thin" style={{ maxHeight: '420px' }}>
        {/* KPI deltas */}
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-line-subtle rounded-sm px-2.5 py-2">
            <div className="font-mono text-[9px] tracking-meta uppercase text-fg-secondary">Cash</div>
            <div className={['font-mono text-[13px] tabular-nums', deltaColor(kpis.cash_delta)].join(' ')}>
              {fmtSigned(kpis.cash_delta)}
            </div>
          </div>
          <div className="border border-line-subtle rounded-sm px-2.5 py-2">
            <div className="font-mono text-[9px] tracking-meta uppercase text-fg-secondary">Equity</div>
            <div className={['font-mono text-[13px] tabular-nums', deltaColor(kpis.equity_delta)].join(' ')}>
              {fmtSigned(kpis.equity_delta)}
            </div>
          </div>
          <div className="border border-line-subtle rounded-sm px-2.5 py-2">
            <div className="font-mono text-[9px] tracking-meta uppercase text-fg-secondary">Holdings</div>
            <div className={['font-mono text-[13px] tabular-nums', deltaColor(kpis.count_delta)].join(' ')}>
              {kpis.count_delta > 0 ? '+' : ''}
              {kpis.count_delta}
            </div>
          </div>
          <div className="border border-line-subtle rounded-sm px-2.5 py-2">
            <div className="font-mono text-[9px] tracking-meta uppercase text-fg-secondary">AUM (₹Cr)</div>
            <div className={['font-mono text-[13px] tabular-nums', kpis.aum_delta == null ? 'text-fg-secondary' : deltaColor(kpis.aum_delta)].join(' ')}>
              {kpis.aum_delta == null ? '—' : fmtSigned(kpis.aum_delta, '')}
            </div>
          </div>
        </div>

        {category_drift.length > 0 && (
          <div>
            <div className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary mb-1.5">Category Drift</div>
            <ul className="space-y-1">
              {category_drift.slice(0, 6).map((c) => (
                <li key={c.name} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="text-fg-default truncate">{c.name}</span>
                  <span className={['font-mono tabular-nums shrink-0', deltaColor(c.weight)].join(' ')}>{fmtSigned(c.weight)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasAnyChanges ? (
          <div className="space-y-4">
            <ChangeRowList rows={changes.added} kind="added" />
            <ChangeRowList rows={changes.increased} kind="increased" />
            <ChangeRowList rows={changes.reduced} kind="reduced" />
            <ChangeRowList rows={changes.exited} kind="exited" />
          </div>
        ) : (
          <div className="text-[12px] text-fg-secondary py-4 text-center">No holding-level changes detected.</div>
        )}
      </div>
    </section>
  );
}

export function ChangesUnavailable({ message }: { message: string }) {
  return (
    <section className="bg-card border border-line-subtle rounded-sm h-full flex flex-col items-center justify-center px-4 py-8 text-center gap-2" data-testid="changes-unavailable">
      <Info className="h-4 w-4 text-fg-disabled" strokeWidth={2} />
      <p className="text-[12.5px] text-fg-secondary max-w-xs">{message}</p>
    </section>
  );
}
