'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, FileWarning, UploadCloud, Layers } from 'lucide-react';
import { useFund } from '@/components/FundProvider';
import { fetchAnalyse, fetchAIInsight } from '@/lib/client';
import type { ApiError } from '@/lib/client';
import type { AnalyseData, AIInsight, PortfolioMetrics } from '@/lib/types';
import { ResultsHeader } from '@/components/ResultsHeader';
import { KpiTile } from '@/components/KpiTile';
import { AIInsightPanel } from '@/components/AIInsightPanel';
import { AssetAllocationBar } from '@/components/AssetAllocationBar';
import { CategoryDonut } from '@/components/CategoryDonut';
import { MarketCapBar } from '@/components/MarketCapBar';
import { TopHoldings } from '@/components/TopHoldings';
import { HoldingsTable } from '@/components/HoldingsTable';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { ProgressTerminal } from '@/components/ProgressTerminal';
import { Toast } from '@/components/Toast';

type Status = 'idle' | 'loading' | 'ready' | 'nodata' | 'transient' | 'error';

function makeSteps(name: string): string[] {
  return [
    `fetching portfolio for ${name}…`,
    'parsing holdings…',
    'classifying instruments & sectors…',
    'computing category & market-cap mix…',
    'generating AI interpretation…',
  ];
}

const fmtCr = (n: number | null) =>
  n == null ? '—' : '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtNav = (n: number | null) =>
  n == null ? '—' : '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number | null) => (n == null ? '—' : n.toFixed(2) + '%');

function donutMeta(asset: string) {
  if (asset === 'equity') return { title: 'Sector Allocation', center: 'Sectors' };
  if (asset === 'debt') return { title: 'Instrument Mix', center: 'Types' };
  return { title: 'Category Breakdown', center: 'Categories' };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] tracking-wide2 uppercase text-fg-secondary mb-4">{children}</div>
  );
}

// Loud notice when a factsheet discloses only its top-N holdings.
function PartialBanner({ count, coverage }: { count: number; coverage: number }) {
  return (
    <div className="mb-6 flex items-start gap-3 px-4 py-3 bg-tint-warning border border-warning rounded-sm" role="status">
      <Layers className="h-4 w-4 shrink-0 mt-0.5 text-warning" strokeWidth={2} />
      <div className="min-w-0">
        <div className="font-mono text-[10px] tracking-meta uppercase text-warning mb-0.5">Partial disclosure</div>
        <p className="text-[12.5px] text-fg-default leading-snug">
          This factsheet lists only the top {count} holdings — about{' '}
          <span className="font-mono tabular-nums text-fg-primary">{coverage.toFixed(1)}%</span> of NAV. The full portfolio
          isn&apos;t published in this document; metrics below describe the whole fund, holdings describe the disclosed slice.
        </p>
      </div>
    </div>
  );
}

// Portfolio-wide characteristics a factsheet states as aggregates. Palantir-style
// dense table: meta labels, monospace values an operator can read/verify, hairline
// rows. Numeric readouts sit in their own compact band; descriptive ones span wide.
function MetricsStrip({ metrics }: { metrics: PortfolioMetrics }) {
  const nums: { label: string; value: string }[] = [];
  if (metrics.ytm != null) nums.push({ label: 'YTM', value: metrics.ytm.toFixed(2) + '%' });
  if (metrics.macaulay_days != null) nums.push({ label: 'Macaulay Dur.', value: `${metrics.macaulay_days}d` });
  if (metrics.residual_days != null) nums.push({ label: 'Avg Residual', value: `${metrics.residual_days}d` });

  const text: { label: string; value: string }[] = [];
  if (metrics.benchmark) text.push({ label: 'Benchmark', value: metrics.benchmark });
  if (metrics.inception) text.push({ label: 'Inception', value: metrics.inception });
  if (metrics.fund_managers) text.push({ label: 'Fund Manager', value: metrics.fund_managers });

  if (nums.length === 0 && text.length === 0) return null;

  return (
    <section className="pt-8 sm:pt-9 mt-8 sm:mt-9 border-t border-line-subtle">
      <SectionLabel>Portfolio Characteristics</SectionLabel>
      <div className="bg-card border border-line-subtle rounded-sm overflow-hidden">
        {nums.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-line-subtle border-b border-line-subtle">
            {nums.map((it) => (
              <div key={it.label} className="px-3 py-2.5">
                <div className="font-mono text-[9px] tracking-meta uppercase text-fg-secondary">{it.label}</div>
                <div className="font-mono text-[16px] text-fg-primary tabular-nums leading-tight mt-0.5">{it.value}</div>
              </div>
            ))}
          </div>
        )}
        {text.map((it) => (
          <div
            key={it.label}
            className="flex items-baseline gap-3 px-3 py-2 border-b border-line-subtle last:border-0"
          >
            <span className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary w-28 shrink-0">{it.label}</span>
            <span className="font-mono text-[12px] text-fg-primary">{it.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// Portfolio-wide breakdown by credit-rating class (text-readable on most factsheets).
function RatingBreakdown({ data }: { data: { name: string; weight: number }[] }) {
  const max = Math.max(...data.map((d) => Math.abs(d.weight)), 1);
  return (
    <div className="bg-card border border-line-subtle rounded-sm p-4">
      <h3 className="font-mono text-[11px] tracking-wide2 uppercase text-fg-secondary mb-3">By Rating Class</h3>
      <div className="space-y-2.5">
        {data.map((d) => (
          <div key={d.name}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[12px] text-fg-default leading-tight">{d.name}</span>
              <span className="font-mono text-[12px] text-fg-primary tabular-nums shrink-0">{d.weight.toFixed(2)}%</span>
            </div>
            <span className="block h-1 w-full bg-muted rounded-sm overflow-hidden">
              <span
                className={['block h-full rounded-sm', d.weight < 0 ? 'bg-warning' : 'bg-primary'].join(' ')}
                style={{ width: `${(Math.abs(d.weight) / max) * 100}%` }}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const inkBtn =
  'inline-flex items-center gap-2 h-9 px-3.5 bg-ink text-fg-inverse font-mono text-[12px] tracking-meta uppercase rounded-sm hover:bg-ink-hover transition-colors focus-ring';

export function AnalyseView() {
  const { scheme, period, token } = useFund();
  const router = useRouter();

  const [status, setStatus] = useState<Status>('idle');
  const [data, setData] = useState<AnalyseData | null>(null);
  const [ai, setAi] = useState<AIInsight | null>(null);
  const [step, setStep] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const didMount = useRef(false);

  const steps = scheme ? makeSteps(scheme.scheme_name) : [];

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      if (!scheme || !period) {
        setStatus('idle');
        return;
      }
      // First render with scheme+period — kick off a load
    }
    setToast(null);
    if (!scheme || !period) {
      setStatus('idle');
      setData(null);
      setAi(null);
      return;
    }

    setStatus('loading');
    setStep(0);

    const localSteps = makeSteps(scheme.scheme_name);
    let i = 0;
    const iv = setInterval(() => {
      i += 1;
      setStep(i);
      if (i >= localSteps.length) clearInterval(iv);
    }, 360);

    // Capture current scheme/period for async closure
    const schemeId = scheme.id;
    const schemeName = scheme.scheme_name;
    const currentPeriod = period;

    fetchAnalyse(schemeId, currentPeriod, token)
      .then((d) => {
        clearInterval(iv);
        setData(d);
        setStatus('ready');
        // Fire AI insight fetch without blocking
        fetchAIInsight(schemeId, currentPeriod, token).then((ins) => {
          if (ins) setAi(ins);
        });
      })
      .catch((e: ApiError) => {
        clearInterval(iv);
        setData(null);
        setAi(null);
        const msg = e.message || `Couldn't analyse ${schemeName}.`;
        setNotice(msg);
        if (e.status === 404) {
          setStatus('nodata'); // not_covered / not_published / parse_failed
        } else if (e.status === 503) {
          setStatus('transient'); // network blip — retryable
        } else {
          setStatus('error');
          setToast(msg);
        }
      });

    return () => {
      clearInterval(iv);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme?.id, period, token, reloadKey]);

  // ── Idle ──────────────────────────────────────────────
  if (status === 'idle' || !scheme) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center bg-subtle border border-line-subtle rounded-sm mb-5">
          <Search className="h-6 w-6 text-fg-secondary" strokeWidth={1.75} />
        </div>
        <h2 className="font-sans text-[28px] font-semibold tracking-tight text-fg-primary">Choose a fund to begin</h2>
        <p className="text-[14px] text-fg-secondary mt-3 leading-relaxed">
          Pick a fund and a portfolio month from the bar above — or head to{' '}
          <button onClick={() => router.push('/upload')} className="text-fg-link underline underline-offset-2">Upload</button>{' '}
          to analyse any factsheet (PDF or spreadsheet). Holdings, category mix, deployable cash and month-on-month
          deltas — without spreadsheets.
        </p>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="py-14">
        <ProgressTerminal scheme={scheme.id} steps={steps} current={step} />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────
  if (status === 'error') {
    return (
      <>
        <div className="max-w-xl mx-auto py-20 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center bg-tint-error border border-line-subtle rounded-sm mb-5">
            <FileWarning className="h-6 w-6 text-error" strokeWidth={1.75} />
          </div>
          <h2 className="font-sans text-[28px] font-semibold tracking-tight text-fg-primary">Couldn't analyse this fund</h2>
          <p className="text-[14px] text-fg-secondary mt-3 leading-relaxed">
            The latest factsheet for <span className="text-fg-primary">{scheme.scheme_name}</span> failed validation
            during ingestion. You can upload the source file to analyse it directly.
          </p>
          <div className="flex items-center justify-center gap-2 mt-6">
            <button onClick={() => router.push('/upload')} className={inkBtn}>
              <UploadCloud className="h-4 w-4" strokeWidth={2} /> Upload factsheet
            </button>
          </div>
        </div>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </>
    );
  }

  // ── Transient (network blip — retryable) ──────────────
  if (status === 'transient') {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center bg-subtle border border-line-subtle rounded-sm mb-5">
          <FileWarning className="h-6 w-6 text-fg-secondary" strokeWidth={1.75} />
        </div>
        <h2 className="font-sans text-[28px] font-semibold tracking-tight text-fg-primary">Couldn&apos;t reach the source</h2>
        <p className="text-[14px] text-fg-secondary mt-3 leading-relaxed">
          {notice ?? 'The data source didn’t respond just now.'}
        </p>
        <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={() => setReloadKey((k) => k + 1)} className={inkBtn}>
            Retry
          </button>
          <button onClick={() => router.push('/upload')} className="inline-flex items-center gap-2 h-9 px-3.5 bg-card border border-line-default text-fg-primary font-mono text-[12px] tracking-meta uppercase rounded-sm hover:bg-subtle transition-colors focus-ring">
            <UploadCloud className="h-4 w-4" strokeWidth={2} /> Upload instead
          </button>
        </div>
      </div>
    );
  }

  // ── No data (not covered / not published / parse failed) ──
  if (status === 'nodata' || !data) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center bg-subtle border border-line-subtle rounded-sm mb-5">
          <FileWarning className="h-6 w-6 text-fg-secondary" strokeWidth={1.75} />
        </div>
        <h2 className="font-sans text-[28px] font-semibold tracking-tight text-fg-primary">No portfolio for this month</h2>
        <p className="text-[14px] text-fg-secondary mt-3 leading-relaxed">
          {notice ?? (
            <>
              We don&apos;t have a portfolio for <span className="text-fg-primary">{scheme.scheme_name}</span> in{' '}
              <span className="font-mono tabular-nums">{period}</span> yet.
            </>
          )}
        </p>
        <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={() => router.push('/upload')} className={inkBtn}>
            <UploadCloud className="h-4 w-4" strokeWidth={2} /> Upload factsheet
          </button>
        </div>
      </div>
    );
  }

  // ── Ready (populated hero) ────────────────────────────
  const meta = donutMeta(data.asset_class);
  const isEquity = data.market_cap_breakdown.length > 0;

  return (
    <div>
      {data.partial && <PartialBanner count={data.holdings_count} coverage={data.total_weight} />}

      <ResultsHeader data={data} />

      {/* KPI grid */}
      <section className="pt-8 sm:pt-9">
        <SectionLabel>Key Metrics</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 lg:gap-6" data-testid="kpi-grid">
          <KpiTile label="AUM" value={data.aum != null ? `${fmtCr(data.aum)} Cr` : '—'} hint="Assets under management" />
          <KpiTile label="NAV" value={fmtNav(data.nav)} hint={`as of ${data.period_label}`} />
          <KpiTile
            label="Expense Ratio"
            value={fmtPct(data.expense_ratio)}
            hint="Annual, regular plan"
            tooltip="Total recurring cost charged to the scheme as a % of assets, annualised."
          />
          <KpiTile label="Holdings" value={String(data.holdings_count)} hint="Disclosed instruments" />
          <KpiTile
            label="Deployable Cash"
            value={fmtPct(data.deployable_cash)}
            hint="Cash + equivalents"
            tooltip="Share of the portfolio in cash, TREPS and net receivables — dry powder available to deploy."
            accent
          />
          <KpiTile label="Total Weight" value={fmtPct(data.total_weight)} hint="Disclosure coverage" />
        </div>
      </section>

      {/* Portfolio characteristics (factsheet aggregates) */}
      {data.metrics && <MetricsStrip metrics={data.metrics} />}

      {/* AI interpretation — distinct tinted commentary block */}
      {ai && (
        <section className="pt-8 sm:pt-9 mt-8 sm:mt-9 border-t border-line-subtle">
          <SectionLabel>Interpretation</SectionLabel>
          <AIInsightPanel insight={ai} data={data} />
        </section>
      )}

      {/* Allocation */}
      <section className="pt-8 sm:pt-9 mt-8 sm:mt-9 border-t border-line-subtle">
        <SectionLabel>Allocation</SectionLabel>
        <AssetAllocationBar data={data.asset_allocation} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-3 gap-4 mt-4">
          <div className="md:col-span-2 lg:col-span-2">
            <CategoryDonut data={data.category_breakdown} title={meta.title} centerLabel={meta.center} />
          </div>
          <div className="space-y-4 md:col-span-2 lg:col-span-1">
            {isEquity && <MarketCapBar data={data.market_cap_breakdown} />}
            {data.rating_breakdown && data.rating_breakdown.length > 0 && (
              <RatingBreakdown data={data.rating_breakdown} />
            )}
            <div className="bg-card border border-line-subtle rounded-sm p-4">
              <h3 className="font-mono text-[11px] tracking-wide2 uppercase text-fg-secondary mb-3">Cash Composition</h3>
              <div className="space-y-2">
                {data.cash_breakdown.map((c) => (
                  <div key={c.section} className="flex items-center justify-between">
                    <span className="text-[12.5px] text-fg-default">{c.section}</span>
                    <span className="font-mono text-[12px] text-fg-primary tabular-nums">{c.weight.toFixed(2)}%</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t border-line-subtle">
                  <span className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary">Deployable</span>
                  <span className="font-mono text-[12px] text-success tabular-nums">{data.deployable_cash.toFixed(2)}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Holdings */}
      <CollapsibleSection
        className="pt-8 sm:pt-9 mt-8 sm:mt-9 border-t border-line-subtle"
        label="Holdings"
        right={
          <span className="font-mono text-[10px] tracking-meta uppercase text-fg-disabled shrink-0">
            {data.holdings_count} positions
          </span>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1">
            <TopHoldings data={data.top_holdings} totalCount={data.holdings_count} />
          </div>
          <div className="lg:col-span-2">
            <HoldingsTable data={data.holdings} />
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}
