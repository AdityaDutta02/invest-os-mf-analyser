'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronUp, ChevronDown, ChevronsUpDown, ArrowRight, AlertTriangle } from 'lucide-react';
import { useFund } from '@/components/FundProvider';
import { fetchScreener } from '@/lib/client';
import type { ScreenerRow, AssetClass } from '@/lib/types';

const ASSET_COLOR: Record<string, string> = {
  equity: 'var(--cat-1)',
  debt: 'var(--cat-6)',
  hybrid: 'var(--cat-4)',
  other: 'var(--cat-5)',
};
const ASSET_LABEL: Record<string, string> = { equity: 'Equity', debt: 'Debt', hybrid: 'Hybrid', other: 'Other' };

type SortKey =
  | 'scheme_name'
  | 'category'
  | 'aum'
  | 'expense_ratio'
  | 'holdings_count'
  | 'deployable_cash'
  | 'top10_concentration';
type Dir = 'asc' | 'desc';

const COLS: { key: SortKey; label: string; num?: boolean; align?: 'right' }[] = [
  { key: 'scheme_name', label: 'Fund' },
  { key: 'category', label: 'Category' },
  { key: 'aum', label: 'AUM ₹cr', num: true, align: 'right' },
  { key: 'expense_ratio', label: 'Expense %', num: true, align: 'right' },
  { key: 'holdings_count', label: 'Holdings', num: true, align: 'right' },
  { key: 'deployable_cash', label: 'Cash %', num: true, align: 'right' },
  { key: 'top10_concentration', label: 'Top-10 %', num: true, align: 'right' },
];

const FILTERS: { key: 'all' | AssetClass; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'equity', label: 'Equity' },
  { key: 'debt', label: 'Debt' },
  { key: 'hybrid', label: 'Hybrid' },
];

export function ScreenView() {
  const { selectScheme, token } = useFund();
  const router = useRouter();

  const [filter, setFilter] = useState<'all' | AssetClass>('all');
  const [sortKey, setSortKey] = useState<SortKey>('deployable_cash');
  const [dir, setDir] = useState<Dir>('desc');
  const [allRows, setAllRows] = useState<ScreenerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchScreener(token)
      .then((data) => {
        if (!cancelled) {
          setAllRows(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllRows([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const rows = useMemo(() => {
    const out = allRows.filter((r) => filter === 'all' || r.asset_class === filter);
    out.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
    return out;
  }, [allRows, filter, sortKey, dir]);

  const maxCash = allRows.length > 0 ? Math.max(...allRows.map((r) => r.deployable_cash)) : 0;
  const maxConc = allRows.length > 0 ? Math.max(...allRows.map((r) => r.top10_concentration)) : 0;

  function toggle(k: SortKey) {
    if (k === sortKey) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setDir(k === 'scheme_name' || k === 'category' ? 'asc' : 'desc');
    }
  }

  function open(r: ScreenerRow) {
    selectScheme({
      id: r.id,
      scheme_name: r.scheme_name,
      amc_name: r.amc_name,
      category: r.category,
      nav: r.nav,
      asset_class: r.asset_class,
      errors: r.errors,
    });
    router.push('/');
  }

  return (
    <div>
      {/* Hero */}
      <div className="border-t border-line-subtle pt-8">
        <div className="font-mono text-[11px] tracking-meta uppercase text-fg-secondary mb-3">Universe screener</div>
        <h1 className="font-sans text-[30px] sm:text-[38px] lg:text-[42px] leading-[1.05] font-semibold tracking-tight text-fg-primary max-w-3xl">
          Rank funds on what actually differs
        </h1>
        <p className="text-[14px] text-fg-secondary mt-3 leading-relaxed max-w-xl">
          Every ingested scheme, side by side, on the metrics that separate them — deployable cash, cost, breadth and
          concentration. Sort any column; open any fund to go deep.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-4 pt-8 flex-wrap">
        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={[
                'h-8 px-3 font-mono text-[11px] tracking-meta uppercase rounded-sm border transition-colors focus-ring',
                filter === f.key
                  ? 'bg-ink text-fg-inverse border-ink'
                  : 'bg-card text-fg-secondary border-line-default hover:text-fg-primary',
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="font-mono text-[10px] tracking-meta uppercase text-fg-disabled">{rows.length} funds</span>
      </div>

      {/* Loading */}
      {loading && (
        <div className="mt-4 py-16 text-center font-mono text-[12px] text-fg-secondary">Loading screener data…</div>
      )}

      {/* Empty */}
      {!loading && allRows.length === 0 && (
        <div className="mt-4 py-16 text-center font-mono text-[12px] text-fg-secondary">
          No funds ingested yet. Upload a factsheet to get started.
        </div>
      )}

      {/* Table */}
      {!loading && allRows.length > 0 && (
        <div className="mt-4 bg-card border border-line-subtle rounded-sm overflow-hidden">
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full border-collapse min-w-[860px]">
              <thead>
                <tr className="bg-subtle">
                  {COLS.map((c) => {
                    const active = c.key === sortKey;
                    const Icon = active ? (dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
                    return (
                      <th
                        key={c.key}
                        className={[
                          'px-3 py-2.5 font-mono text-[10px] tracking-meta uppercase',
                          c.align === 'right' ? 'text-right' : 'text-left',
                        ].join(' ')}
                      >
                        <button
                          onClick={() => toggle(c.key)}
                          className={[
                            'inline-flex items-center gap-1 hover:text-fg-primary transition-colors focus-ring rounded-sm',
                            active ? 'text-fg-primary' : 'text-fg-secondary',
                            c.align === 'right' ? 'flex-row-reverse' : '',
                          ].join(' ')}
                        >
                          {c.label}
                          <Icon className="h-3 w-3" strokeWidth={2.25} />
                        </button>
                      </th>
                    );
                  })}
                  <th className="px-3 py-2.5 w-px" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="group border-b border-line-subtle last:border-0 hover:bg-subtle transition-colors"
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ background: ASSET_COLOR[r.asset_class] }}
                          title={ASSET_LABEL[r.asset_class]}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] text-fg-primary font-medium">{r.scheme_name}</span>
                            {r.errors && (
                              <span title="Latest ingestion failed">
                                <AlertTriangle className="h-3.5 w-3.5 text-warning" strokeWidth={2} />
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[10.5px] text-fg-disabled">{r.amc_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[12px] text-fg-secondary whitespace-nowrap">{r.category}</td>
                    <td className="px-3 py-3 text-right font-mono text-[12px] text-fg-default tabular-nums">
                      {r.aum.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-[12px] text-fg-default tabular-nums">
                      {r.expense_ratio.toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-[12px] text-fg-default tabular-nums">
                      {r.holdings_count}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        {r.deployable_cash === maxCash && (
                          <span
                            className="font-mono text-[8.5px] tracking-meta uppercase text-white px-1 py-px rounded-sm"
                            style={{ background: 'var(--cat-1)' }}
                          >
                            High
                          </span>
                        )}
                        <span className="font-mono text-[12px] text-fg-primary tabular-nums">
                          {r.deployable_cash.toFixed(2)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        {r.top10_concentration === maxConc && (
                          <span
                            className="font-mono text-[8.5px] tracking-meta uppercase text-white px-1 py-px rounded-sm"
                            style={{ background: 'var(--cat-2)' }}
                          >
                            Conc
                          </span>
                        )}
                        <span className="font-mono text-[12px] text-fg-default tabular-nums">
                          {r.top10_concentration.toFixed(1)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={() => open(r)}
                        className="inline-flex items-center gap-1 font-mono text-[10px] tracking-meta uppercase text-fg-secondary hover:text-fg-primary transition-colors focus-ring rounded-sm opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                      >
                        Analyse <ArrowRight className="h-3 w-3" strokeWidth={2} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!loading && allRows.length > 0 && (
        <p className="font-mono text-[10px] tracking-meta uppercase text-fg-disabled mt-3">
          Hover a row to open it · <span className="text-warning">▲</span> = latest factsheet failed to ingest
        </p>
      )}
    </div>
  );
}
