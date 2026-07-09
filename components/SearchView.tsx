'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ArrowRight } from 'lucide-react';
import { useFund } from '@/components/FundProvider';
import { fetchSearch } from '@/lib/client';
import type { SearchResult, SchemeMatch, AssetClass } from '@/lib/types';

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

  const empty = result.type === 'empty';
  // The ISIN "who holds this" lookup is disabled for now (see result.type
  // === 'isin' branch removed below) — treat an ISIN-shaped query the same
  // as a fund search with no hits rather than surfacing that feature's UI.
  const isName = result.type === 'name' || result.type === 'isin';
  const noNameHits = result.type === 'isin' || (result.type === 'name' && result.securities.length === 0 && result.schemes.length === 0);

  return (
    <div>
      <div className="border-t border-line-subtle pt-8">
        <div className="font-mono text-[11px] tracking-meta uppercase text-fg-secondary mb-3">
          Full corpus search
        </div>
        <h1 className="font-sans text-[30px] sm:text-[38px] lg:text-[42px] leading-[1.05] font-semibold tracking-tight text-fg-primary max-w-3xl">
          Find any fund
        </h1>
        <p className="text-[14px] text-fg-secondary mt-3 leading-relaxed max-w-xl">
          Search across every ingested disclosure by fund name, AMC or category.
        </p>
      </div>

      <div className="mt-6 flex items-center gap-2 h-11 px-4 bg-card border border-line-default rounded-sm focus-within:border-line-focus">
        <Search className="h-4 w-4 text-fg-secondary shrink-0" strokeWidth={2} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Parag Parikh Flexi Cap, HDFC, Small Cap…"
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

      {/* Name/fuzzy result — the ISIN "who holds this" lookup is disabled for
          now; an ISIN-shaped query is treated as a fund search with no hits. */}
      {!loading && isName && (
        <div className="mt-6 space-y-8">
          {noNameHits && (
            <div className="py-16 text-center font-mono text-[12px] text-fg-secondary">
              No match for &quot;{query}&quot;.
            </div>
          )}

          {result.type === 'name' && result.schemes.length > 0 && (
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
        </div>
      )}
    </div>
  );
}
