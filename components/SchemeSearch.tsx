'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X, CornerDownLeft, Loader2 } from 'lucide-react';
import { searchSchemes, fetchSchemeMeta } from '@/lib/client';
import { useFund } from '@/components/FundProvider';
import type { SchemeSummary } from '@/lib/types';

function fmtNav(n: number | null) {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SchemeSearch({
  scheme,
  onSelect,
}: {
  scheme: SchemeSummary | null;
  onSelect: (s: SchemeSummary) => void;
}) {
  const { token } = useFund();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [results, setResults] = useState<SchemeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [searched, setSearched] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = useRef(0); // sequence guard against out-of-order responses

  const doSearch = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!q.trim()) {
        reqId.current += 1; // invalidate any in-flight request
        setResults([]);
        setLoading(false);
        setFailed(false);
        setSearched(false);
        return;
      }
      setLoading(true);
      setFailed(false);
      debounceRef.current = setTimeout(async () => {
        const id = ++reqId.current;
        try {
          const data = await searchSchemes(q, token);
          if (id !== reqId.current) return; // a newer query superseded this one
          setResults(data);
          setSearched(true);
          setLoading(false);
          // progressively enrich the visible rows with category + NAV
          const codes = data.slice(0, 12).map((s) => s.id);
          if (codes.length) {
            fetchSchemeMeta(codes, token)
              .then((metas) => {
                if (id !== reqId.current) return;
                const byId = new Map(metas.map((m) => [m.id, m]));
                setResults((prev) =>
                  prev.map((s) => {
                    const m = byId.get(s.id);
                    return m ? { ...s, nav: m.nav, category: m.category || s.category, asset_class: (m.asset_class as SchemeSummary['asset_class']) || s.asset_class } : s;
                  }),
                );
              })
              .catch(() => {});
          }
        } catch {
          if (id !== reqId.current) return;
          setResults([]);
          setLoading(false);
          setFailed(true);
          setSearched(true);
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

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => setHi(0), [query, open]);

  function choose(s: SchemeSummary) {
    onSelect(s);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[hi]) choose(results[hi]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0" data-testid="scheme-search">
      <div
        className={[
          'flex items-center gap-2 h-9 px-3 bg-card border rounded-sm transition-colors',
          open ? 'border-line-focus' : 'border-line-default',
        ].join(' ')}
        style={open ? { boxShadow: '0 0 0 2px var(--border-focus-ring)' } : undefined}
      >
        <Search className="h-4 w-4 text-fg-secondary shrink-0" strokeWidth={2} />
        <input
          ref={inputRef}
          value={open ? query : scheme ? scheme.scheme_name : query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Search any Indian mutual fund — name, AMC or category…"
          className="flex-1 min-w-0 bg-transparent outline-none text-[16px] sm:text-[13px] text-fg-default placeholder:text-fg-secondary font-sans"
          data-testid="scheme-search-input"
        />
        {(open && query) || (scheme && open) ? (
          <button
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="text-fg-secondary hover:text-fg-primary shrink-0"
            aria-label="Clear"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        ) : (
          <kbd className="hidden md:flex items-center gap-1 font-mono text-[10px] text-fg-secondary border border-line-muted rounded-sm px-1.5 py-0.5 shrink-0">
            /
          </kbd>
        )}
      </div>

      {open && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 bg-card border border-line-subtle rounded-sm overflow-hidden anim-fade-up"
          style={{ boxShadow: 'var(--shadow-3)' }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-line-subtle bg-subtle">
            <span className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary flex items-center gap-1.5">
              {loading ? (
                <>
                  <Loader2 className="h-3 w-3 anim-spin" /> Searching…
                </>
              ) : (
                `${results.length} scheme${results.length === 1 ? '' : 's'}`
              )}
            </span>
            <span className="hidden sm:flex items-center gap-1 font-mono text-[10px] text-fg-secondary">
              <CornerDownLeft className="h-3 w-3" /> select
            </span>
          </div>
          <ul className="max-h-72 overflow-y-auto scroll-thin">
            {results.length === 0 && (
              <li className="px-3 py-6 text-center text-[13px] text-fg-secondary">
                {loading
                  ? 'Searching schemes…'
                  : failed
                    ? "Couldn't search just now — try again."
                    : !query.trim()
                      ? 'Type to search schemes…'
                      : searched
                        ? `No scheme matches "${query}".`
                        : 'Searching schemes…'}
              </li>
            )}
            {results.map((s, i) => (
              <li key={s.id}>
                <button
                  onMouseEnter={() => setHi(i)}
                  onClick={() => choose(s)}
                  className={[
                    'w-full flex items-center gap-3 px-3 py-2.5 text-left border-l-2 transition-colors',
                    i === hi ? 'bg-tint-info border-primary' : 'border-transparent hover:bg-subtle',
                  ].join(' ')}
                  data-testid={`scheme-option-${s.id}`}
                >
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
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
