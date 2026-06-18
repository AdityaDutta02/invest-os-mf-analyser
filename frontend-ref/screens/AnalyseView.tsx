import { useEffect, useRef, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { Search, FileWarning, UploadCloud } from "lucide-react";
import type { FundCtx } from "../components/Layout";
import { getAnalyse, getAIInsight, SCHEMES } from "../lib/mock";
import type { AnalyseData, AIInsight } from "../lib/mock";
import { ResultsHeader } from "../components/ResultsHeader";
import { KpiTile } from "../components/KpiTile";
import { AIInsightPanel } from "../components/AIInsightPanel";
import { AssetAllocationBar } from "../components/AssetAllocationBar";
import { CategoryDonut } from "../components/CategoryDonut";
import { MarketCapBar } from "../components/MarketCapBar";
import { TopHoldings } from "../components/TopHoldings";
import { HoldingsTable } from "../components/HoldingsTable";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { ProgressTerminal } from "../components/ProgressTerminal";
import { Toast } from "../components/Toast";

type Status = "idle" | "loading" | "ready" | "nodata" | "error";

function makeSteps(name: string): string[] {
  return [
    `fetching portfolio for ${name}…`,
    "parsing holdings…",
    "classifying instruments & sectors…",
    "computing category & market-cap mix…",
    "generating AI interpretation…",
  ];
}

const fmtCr = (n: number | null) =>
  n == null ? "—" : "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtNav = (n: number | null) =>
  n == null ? "—" : "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number | null) => (n == null ? "—" : n.toFixed(2) + "%");

function donutMeta(asset: string) {
  if (asset === "equity") return { title: "Sector Allocation", center: "Sectors" };
  if (asset === "debt") return { title: "Instrument Mix", center: "Types" };
  return { title: "Category Breakdown", center: "Categories" };
}

// Section label — tiny mono caps, Palantir editorial marker
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] tracking-wide2 uppercase text-fg-secondary mb-4">{children}</div>
  );
}

const inkBtn =
  "inline-flex items-center gap-2 h-9 px-3.5 bg-ink text-fg-inverse font-mono text-[12px] tracking-meta uppercase rounded-sm hover:bg-ink-hover transition-colors focus-ring";

export function AnalyseView() {
  const { scheme, period } = useOutletContext<FundCtx>();
  const navigate = useNavigate();

  const [status, setStatus] = useState<Status>(() => {
    if (!scheme || !period) return "idle";
    return getAnalyse(scheme.id, period) ? "ready" : "nodata";
  });
  const [data, setData] = useState<AnalyseData | null>(() =>
    scheme && period ? getAnalyse(scheme.id, period) : null,
  );
  const [ai, setAi] = useState<AIInsight | null>(() => (scheme ? getAIInsight(scheme.id) : null));
  const [step, setStep] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const didMount = useRef(false);

  const steps = scheme ? makeSteps(scheme.scheme_name) : [];

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    setToast(null);
    if (!scheme || !period) {
      setStatus("idle");
      setData(null);
      setAi(null);
      return;
    }
    setStatus("loading");
    setStep(0);
    const localSteps = makeSteps(scheme.scheme_name);
    let i = 0;
    const iv = setInterval(() => {
      i += 1;
      setStep(i);
      if (i >= localSteps.length) clearInterval(iv);
    }, 360);
    const done = setTimeout(() => {
      if (scheme.errors) {
        setStatus("error");
        setData(null);
        setAi(null);
        setToast(
          `Could not parse the latest ${scheme.scheme_name} portfolio — the source factsheet failed validation. Upload it manually to analyse.`,
        );
        return;
      }
      const d = getAnalyse(scheme.id, period);
      if (d) {
        setData(d);
        setAi(getAIInsight(scheme.id));
        setStatus("ready");
      } else {
        setStatus("nodata");
        setData(null);
        setAi(null);
      }
    }, localSteps.length * 360 + 340);
    return () => {
      clearInterval(iv);
      clearTimeout(done);
    };
  }, [scheme, period]);

  // ── Idle ──────────────────────────────────────────────
  if (status === "idle" || !scheme) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center bg-subtle border border-line-subtle rounded-sm mb-5">
          <Search className="h-6 w-6 text-fg-secondary" strokeWidth={1.75} />
        </div>
        <h2 className="font-sans text-[28px] font-semibold tracking-tight text-fg-primary">Search a fund to begin</h2>
        <p className="text-[14px] text-fg-secondary mt-3 leading-relaxed">
          Pick any Indian mutual fund and a portfolio month. Get the holdings, category mix, deployable cash and
          month-on-month deltas — without spreadsheets.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
          {SCHEMES.slice(0, 4).map((s) => (
            <span key={s.id} className="font-mono text-[11px] text-fg-secondary border border-line-muted rounded-sm px-2 py-1">
              {s.scheme_name}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="py-14">
        <ProgressTerminal scheme={scheme.id} steps={steps} current={step} />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────
  if (status === "error") {
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
            <button onClick={() => navigate("/upload")} className={inkBtn}>
              <UploadCloud className="h-4 w-4" strokeWidth={2} /> Upload factsheet
            </button>
          </div>
        </div>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </>
    );
  }

  // ── No data ───────────────────────────────────────────
  if (status === "nodata" || !data) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center bg-subtle border border-line-subtle rounded-sm mb-5">
          <FileWarning className="h-6 w-6 text-fg-secondary" strokeWidth={1.75} />
        </div>
        <h2 className="font-sans text-[28px] font-semibold tracking-tight text-fg-primary">No stored data for this month</h2>
        <p className="text-[14px] text-fg-secondary mt-3 leading-relaxed">
          We don't have an ingested portfolio for{" "}
          <span className="text-fg-primary">{scheme.scheme_name}</span> in{" "}
          <span className="font-mono tabular-nums">{period}</span>. Pick another month, or upload the factsheet to
          analyse it now.
        </p>
        <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={() => navigate("/upload")} className={inkBtn}>
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
      <ResultsHeader data={data} />

      {/* KPI grid */}
      <section className="pt-8 sm:pt-9">
        <SectionLabel>Key Metrics</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 lg:gap-6" data-testid="kpi-grid">
          <KpiTile label="AUM" value={data.aum != null ? `${fmtCr(data.aum)} Cr` : "—"} hint="Assets under management" />
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

      {/* AI interpretation — distinct tinted commentary block */}
      {ai && (
        <section className="pt-8 sm:pt-9 mt-8 sm:mt-9 border-t border-line-subtle">
          <SectionLabel>Interpretation</SectionLabel>
          <AIInsightPanel insight={ai} />
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
