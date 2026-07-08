'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ArrowRight } from 'lucide-react';
import { useFund } from '@/components/FundProvider';
import { fetchSearch } from '@/lib/client';
import type { SearchResult, SchemeMatch, AssetClass } from '@/lib/types';

function fmtWeight(w: number | null) {
  if (w == null) return '—';
  return `${w.toFixed(2)}%`;
}

export function SearchView() {
  const { selectScheme, token } = useFund();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult>({ type: 'empty' });
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = useRef(0);

  const doSearch = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!q.trim()) {
        reqId.current += 1;
        setResult({ type: 'empty' });
        setLoading(false);
        setFailed(false);
        return;
      }
      setLoading(true);
      setFailed(false);
      debounceRef.current = setTimeout(async () => {
        const id = ++reqId.current;
        try {
          const data = await fetchSearch(q, token);
          if (id !== reqId.current) return;
          setResult(data);
          setLoading(false);
        } catch {
          if (id !== reqId.current) return;
          setResult({ type: 'empty' });
          setLoading(false);
          setFailed(true);
        }
      }, 250);
    },
    [token],
  );

  useEffect(() => {
    doSearch(query);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  function openScheme(m: SchemeMatch) {
    selectScheme({
      id: m.scheme_code,
      scheme_name: m.scheme_name,
      amc_name: m.amc_name,
      category: m.category,
      nav: null,
      asset_class: m.asset_class as AssetClass,
    });
    router.push('/');
  }

  function openHoldingScheme(scheme_code: string, scheme_name: string, amc_name: string) {
    selectScheme({ id: scheme_code, scheme_name, amc_name, category: '', nav: null, asset_class: 'equity' });
    router.push('/');
  }

  const empty = result.type === 'empty';
  const isIsin = result.type === 'isin';
  const isName = result.type === 'name';
  const noNameHits = isName && result.securities.length === 0 && result.schemes.length === 0;

  return (
    <div>
      <div className="border-t border-line-subtle pt-8">
        <div className="font-mono text-[11px] tracking-meta uppercase text-fg-secondary mb-3">
          Full corpus search
        </div>
        <h1 className="font-sans text-[30px] sm:text-[38px] lg:text-[42px] leading-[1.05] font-semibold tracking-tight text-fg-primary max-w-3xl">
          Find any security, fund or ISIN
        </h1>
        <p className="text-[14px] text-fg-secondary mt-3 leading-relaxed max-w-xl">
          Search across every ingested disclosure — a company name, a fund name, or an exact ISIN to see which
          schemes hold it and at what weight.
        </p>
      </div>

      <div className="mt-6 flex items-center gap-2 h-11 px-4 bg-card border border-line-default rounded-sm focus-within:border-line-focus">
        <Search className="h-4 w-4 text-fg-secondary shrink-0" strokeWidth={2} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. HDFC Bank, INE040A01034, Parag Parikh Flexi Cap…"
          className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-fg-default placeholder:text-fg-secondary font-sans"
          data-testid="corpus-search-input"
        />
      </div>

      {loading && (
        <div className="mt-6 py-16 text-center font-mono text-[12px] text-fg-secondary">Searching corpus…</div>
      )}

      {!loading && failed && (
        <div className="mt-6 py-16 text-center font-mono text-[12px] text-fg-secondary">
          Couldn&apos;t search just now — try again.
        </div>
      )}

      {!loading && !failed && empty && query.trim() === '' && (
        <div className="mt-6 py-16 text-center font-mono text-[12px] text-fg-secondary">
          Type to search the full disclosure corpus…
        </div>
      )}

      {/* ISIN result */}
      {!loading && isIsin && (
        <div className="mt-6">
          <div className="flex items-baseline gap-3 mb-3">
            <span className="font-mono text-[11px] tracking-meta uppercase text-fg-secondary">{result.isin}</span>
            {result.security_name && (
              <span className="text-[15px] text-fg-primary font-medium">{result.security_name}</span>
            )}
            <span className="font-mono text-[10px] tracking-meta uppercase text-fg-disabled ml-auto">
              held by {result.holder_count} scheme{result.holder_count === 1 ? '' : 's'}
            </span>
          </div>
          {result.holdings.length === 0 ? (
            <div className="py-16 text-center font-mono text-[12px] text-fg-secondary">
              {result.index_building
                ? 'Holdings index is still building for the backfilled archive — check back soon.'
                : 'No ingested scheme currently holds this ISIN.'}
            </div>
          ) : (
            <div className="bg-card border border-line-subtle rounded-sm overflow-hidden">
              <div className="overflow-x-auto scroll-thin">
                <table className="w-full border-collapse min-w-[640px]">
                  <thead>
                    <tr className="bg-subtle">
                      <th className="px-3 py-2.5 text-left font-mono text-[10px] tracking-meta uppercase text-fg-secondary">
                        Fund
                      </th>
                      <th className="px-3 py-2.5 text-left font-mono text-[10px] tracking-meta uppercase text-fg-secondary">
                        Period
                      </th>
                      <th className="px-3 py-2.5 text-right font-mono text-[10px] tracking-meta uppercase text-fg-secondary">
                        Weight
                      </th>
                      <th className="px-3 py-2.5 w-px" />
                    </tr>
                  </thead>
                  <tbody>
                    {result.holdings.map((h) => (
                      <tr
                        key={h.scheme_code}
                        className="group border-b border-line-subtle last:border-0 hover:bg-subtle transition-colors"
                      >
                        <td className="px-3 py-3">
                          <div className="text-[13px] text-fg-primary font-medium">{h.scheme_name}</div>
                          <div className="font-mono text-[10.5px] text-fg-disabled">{h.amc_name}</div>
                        </td>
                        <td className="px-3 py-3 font-mono text-[12px] text-fg-secondary">{h.period}</td>
                        <td className="px-3 py-3 text-right font-mono text-[12px] text-fg-default tabular-nums">
                          {fmtWeight(h.weight)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            onClick={() => openHoldingScheme(h.scheme_code, h.scheme_name, h.amc_name)}
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
        </div>
      )}

      {/* Name/fuzzy result */}
      {!loading && isName && (
        <div className="mt-6 space-y-8">
          {noNameHits && (
            <div className="py-16 text-center font-mono text-[12px] text-fg-secondary">
              No match for &quot;{result.query}&quot;.
            </div>
          )}

          {result.schemes.length > 0 && (
            <div>
              <div className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary mb-2">
                Funds ({result.schemes.length})
              </div>
              <ul className="bg-card border border-line-subtle rounded-sm divide-y divide-line-subtle overflow-hidden">
                {result.schemes.map((s) => (
                  <li key={s.scheme_code}>
                    <button
                      onClick={() => openScheme(s)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-subtle transition-colors"
                      data-testid={`search-scheme-${s.scheme_code}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-fg-primary truncate">{s.scheme_name}</div>
                        <div className="font-mono text-[11px] text-fg-secondary truncate">
                          {s.amc_name} <span className="text-fg-disabled">·</span> {s.category}
                        </div>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-fg-secondary shrink-0" strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.securities.length > 0 && (
            <div>
              <div className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary mb-2">
                Securities ({result.securities.length})
              </div>
              <ul className="bg-card border border-line-subtle rounded-sm divide-y divide-line-subtle overflow-hidden">
                {result.securities.map((sec) => (
                  <li key={sec.isin}>
                    <button
                      onClick={() => setQuery(sec.isin)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-subtle transition-colors"
                      data-testid={`search-security-${sec.isin}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-fg-primary truncate">{sec.name}</div>
                        <div className="font-mono text-[11px] text-fg-secondary truncate">{sec.isin}</div>
                      </div>
                      <span className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary shrink-0">
                        who holds this →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
