import { useMemo, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { ArrowUp, ArrowDown, ArrowUpRight, GitCompare, UploadCloud, ChevronDown } from "lucide-react";
import type { FundCtx } from "../components/Layout";
import { getAnalyse, getComparePeriods, catColor } from "../lib/mock";
import { CollapsibleSection } from "../components/CollapsibleSection";
import type { AnalyseData, Holding } from "../lib/mock";

const ASSET_LABEL: Record<string, string> = { equity: "Equity", debt: "Debt", hybrid: "Hybrid", other: "Other" };
const BLOCK: Record<string, string> = {
  equity: "var(--cat-1)",
  debt: "var(--cat-6)",
  hybrid: "var(--cat-4)",
  other: "var(--cat-5)",
};

const fmtCr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtNav = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const inkBtn =
  "inline-flex items-center gap-2 h-9 px-3.5 bg-ink text-fg-inverse font-mono text-[12px] tracking-meta uppercase rounded-sm hover:bg-ink-hover transition-colors focus-ring";

function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="font-mono text-[10px] tracking-wide2 uppercase text-fg-secondary">{children}</div>
      {right}
    </div>
  );
}

// Signed delta — direction + colour, magnitude rendered by `format`
function Delta({ v, format, threshold = 0.005 }: { v: number; format: (n: number) => string; threshold?: number }) {
  if (Math.abs(v) < threshold) {
    return <span className="font-mono text-[11px] text-fg-disabled">no change</span>;
  }
  const up = v > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={["inline-flex items-center gap-0.5 font-mono text-[11px] tabular-nums", up ? "text-success" : "text-error"].join(" ")}>
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {up ? "+" : "−"}
      {format(Math.abs(v))}
    </span>
  );
}

function PeriodSelect({
  value,
  options,
  onChange,
  disabledValue,
}: {
  value: string;
  options: { period: string; label: string }[];
  onChange: (v: string) => void;
  disabledValue?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-card border border-line-default rounded-sm pl-3 pr-8 h-8 font-mono text-[12px] text-fg-primary tabular-nums focus-ring cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.period} value={o.period} disabled={o.period === disabledValue}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="h-3.5 w-3.5 text-fg-secondary absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" strokeWidth={2} />
    </div>
  );
}

export function CompareView() {
  const { scheme } = useOutletContext<FundCtx>();
  const navigate = useNavigate();
  const periods = scheme ? getComparePeriods(scheme.id) : [];

  const [curP, setCurP] = useState(periods[0]?.period ?? "");
  const [baseP, setBaseP] = useState(periods[1]?.period ?? "");

  // ── Idle ──────────────────────────────────────────────
  if (!scheme) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center bg-subtle border border-line-subtle rounded-sm mb-5">
          <GitCompare className="h-6 w-6 text-fg-secondary" strokeWidth={1.75} />
        </div>
        <h2 className="font-sans text-[28px] font-semibold tracking-tight text-fg-primary">Pick a fund to compare</h2>
        <p className="text-[14px] text-fg-secondary mt-3 leading-relaxed">
          Search a fund in the bar above, then stack two disclosure months to see how the book shifted — asset mix,
          sector rotation, and every position that moved.
        </p>
      </div>
    );
  }

  // ── Insufficient history ──────────────────────────────
  if (periods.length < 2) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center bg-subtle border border-line-subtle rounded-sm mb-5">
          <GitCompare className="h-6 w-6 text-fg-secondary" strokeWidth={1.75} />
        </div>
        <h2 className="font-sans text-[28px] font-semibold tracking-tight text-fg-primary">Need two months to compare</h2>
        <p className="text-[14px] text-fg-secondary mt-3 leading-relaxed">
          We only have <span className="font-mono">{periods.length}</span> ingested month
          {periods.length === 1 ? "" : "s"} for <span className="text-fg-primary">{scheme.scheme_name}</span>. Upload an
          earlier factsheet to unlock the month-on-month comparison.
        </p>
        <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={() => navigate("/upload")} className={inkBtn}>
            <UploadCloud className="h-4 w-4" strokeWidth={2} /> Upload earlier factsheet
          </button>
        </div>
      </div>
    );
  }

  const cur = getAnalyse(scheme.id, curP) as AnalyseData;
  const base = getAnalyse(scheme.id, baseP) as AnalyseData;
  if (!cur || !base || curP === baseP) {
    return (
      <div className="py-20 text-center font-mono text-[12px] text-fg-secondary">Pick two different months.</div>
    );
  }

  return (
    <CompareBody
      scheme={scheme}
      cur={cur}
      base={base}
      periods={periods}
      curP={curP}
      baseP={baseP}
      onCur={(v) => {
        if (v === baseP) setBaseP(curP);
        setCurP(v);
      }}
      onBase={(v) => {
        if (v === curP) setCurP(baseP);
        setBaseP(v);
      }}
    />
  );
}

const notCash = (h: Holding) => h.instrument_type !== "Cash & Equivalent";

function CompareBody({
  scheme,
  cur,
  base,
  periods,
  curP,
  baseP,
  onCur,
  onBase,
}: {
  scheme: { scheme_name: string; asset_class: string; category: string };
  cur: AnalyseData;
  base: AnalyseData;
  periods: { period: string; label: string }[];
  curP: string;
  baseP: string;
  onCur: (v: string) => void;
  onBase: (v: string) => void;
}) {
  // Position-level diff, matched on ISIN, cash excluded
  const positions = useMemo(() => {
    const map = new Map<string, { name: string; sector: string; base: number; cur: number }>();
    base.holdings.filter(notCash).forEach((h) => map.set(h.isin, { name: h.name, sector: h.sector, base: h.weight, cur: 0 }));
    cur.holdings.filter(notCash).forEach((h) => {
      const e = map.get(h.isin);
      if (e) e.cur = h.weight;
      else map.set(h.isin, { name: h.name, sector: h.sector, base: 0, cur: h.weight });
    });
    const rows = [...map.values()].map((e) => {
      const delta = e.cur - e.base;
      const status: "new" | "exit" | "change" = e.base === 0 ? "new" : e.cur === 0 ? "exit" : "change";
      return { ...e, delta, status };
    });
    rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return rows;
  }, [cur, base]);

  const counts = useMemo(() => {
    let inc = 0, red = 0, nw = 0, ex = 0;
    positions.forEach((p) => {
      if (p.status === "new") nw++;
      else if (p.status === "exit") ex++;
      else if (p.delta > 0.005) inc++;
      else if (p.delta < -0.005) red++;
    });
    return { inc, red, nw, ex };
  }, [positions]);

  // Sector rotation, matched on name
  const rotation = useMemo(() => {
    const map = new Map<string, { base: number; cur: number }>();
    base.category_breakdown.forEach((c) => map.set(c.name, { base: c.weight, cur: 0 }));
    cur.category_breakdown.forEach((c) => {
      const e = map.get(c.name);
      if (e) e.cur = c.weight;
      else map.set(c.name, { base: 0, cur: c.weight });
    });
    const rows = [...map.entries()].map(([name, v]) => ({ name, ...v, delta: v.cur - v.base }));
    rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return rows;
  }, [cur, base]);

  const curLabel = periods.find((p) => p.period === curP)?.label ?? curP;
  const baseLabel = periods.find((p) => p.period === baseP)?.label ?? baseP;

  return (
    <div>
      {/* Hero */}
      <div className="border-t border-line-subtle pt-8">
        <div className="flex flex-col sm:flex-row gap-5 sm:gap-7 lg:gap-10">
          <div
            className="relative shrink-0 w-full sm:w-[160px] lg:w-[208px] aspect-[16/9] sm:aspect-square rounded-sm overflow-hidden"
            style={{ background: BLOCK[scheme.asset_class] }}
          >
            <div className="absolute inset-0 p-4 flex flex-col justify-between text-white">
              <span className="font-mono text-[10px] tracking-wide2 uppercase text-white/75">
                {ASSET_LABEL[scheme.asset_class]} · Drift
              </span>
              <div className="flex items-end justify-between gap-2">
                <span className="text-[17px] font-semibold leading-tight tracking-tight">{scheme.category}</span>
                <GitCompare className="h-5 w-5 shrink-0" strokeWidth={2} />
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[11px] tracking-meta uppercase text-fg-secondary mb-3">Month-on-month comparison</div>
            <h1 className="font-sans text-[26px] sm:text-[32px] lg:text-[42px] leading-[1.05] font-semibold tracking-tight text-fg-primary max-w-3xl">
              {scheme.scheme_name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-4 sm:mt-5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] tracking-meta uppercase text-fg-disabled">Current</span>
                <PeriodSelect value={curP} options={periods} onChange={onCur} disabledValue={baseP} />
              </div>
              <span className="font-mono text-[11px] text-fg-disabled uppercase tracking-meta">vs</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] tracking-meta uppercase text-fg-disabled">Baseline</span>
                <PeriodSelect value={baseP} options={periods} onChange={onBase} disabledValue={curP} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delta KPIs */}
      <section className="pt-8 sm:pt-9">
        <SectionLabel>
          What moved · {baseLabel} <span className="text-fg-disabled">→</span> {curLabel}
        </SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
          <CmpKpi label="AUM" cur={fmtCr(cur.aum ?? 0) + " Cr"} d={(cur.aum ?? 0) - (base.aum ?? 0)} fmt={(n) => fmtCr(n) + " Cr"} base={fmtCr(base.aum ?? 0)} />
          <CmpKpi label="NAV" cur={fmtNav(cur.nav ?? 0)} d={(cur.nav ?? 0) - (base.nav ?? 0)} fmt={(n) => fmtNav(n)} base={fmtNav(base.nav ?? 0)} />
          <CmpKpi label="Holdings" cur={String(cur.holdings_count)} d={cur.holdings_count - base.holdings_count} fmt={(n) => String(Math.round(n))} base={String(base.holdings_count)} threshold={0.5} />
          <CmpKpi label="Deployable Cash" cur={cur.deployable_cash.toFixed(2) + "%"} d={cur.deployable_cash - base.deployable_cash} fmt={(n) => n.toFixed(2) + "pp"} base={base.deployable_cash.toFixed(2) + "%"} />
        </div>
      </section>

      {/* Allocation drift */}
      <section className="pt-8 sm:pt-9 mt-8 sm:mt-9 border-t border-line-subtle">
        <SectionLabel>Asset-mix drift</SectionLabel>
        <div className="bg-card border border-line-subtle rounded-sm p-4">
          <DriftBar label={baseLabel} data={base.asset_allocation} muted />
          <div className="mt-4">
            <DriftBar label={curLabel} data={cur.asset_allocation} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3 mt-5 pt-4 border-t border-line-subtle">
            {cur.asset_allocation.map((c, i) => {
              const b = base.asset_allocation.find((x) => x.name === c.name)?.weight ?? 0;
              return (
                <div key={c.name} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: catColor(i, c.name) }} />
                    <span className="text-[12px] text-fg-default truncate">{c.name}</span>
                  </div>
                  <Delta v={c.weight - b} format={(n) => n.toFixed(2) + "pp"} />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Sector rotation */}
      <CollapsibleSection
        className="pt-8 sm:pt-9 mt-8 sm:mt-9 border-t border-line-subtle"
        label="Sector rotation"
        right={
          <span className="font-mono text-[10px] tracking-meta uppercase text-fg-disabled shrink-0">
            {rotation.length} sectors
          </span>
        }
      >
        <div className="bg-card border border-line-subtle rounded-sm divide-y divide-line-subtle">
          {rotation.map((r) => (
            <div key={r.name} className="flex items-center gap-2 sm:gap-4 px-3 sm:px-4 py-2.5">
              <span className="text-[12.5px] text-fg-primary flex-1 min-w-0 truncate">{r.name}</span>
              <span className="font-mono text-[11.5px] text-fg-disabled tabular-nums w-14 text-right">{r.base.toFixed(2)}</span>
              <ArrowUpRight className="h-3 w-3 text-fg-disabled shrink-0 rotate-45" strokeWidth={2} />
              <span className="font-mono text-[11.5px] text-fg-default tabular-nums w-14 text-right">{r.cur.toFixed(2)}</span>
              <span className="w-20 text-right">
                <Delta v={r.delta} format={(n) => n.toFixed(2) + "pp"} />
              </span>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Position changes */}
      <CollapsibleSection
        className="pt-8 sm:pt-9 mt-8 sm:mt-9 border-t border-line-subtle"
        label="Position changes"
        right={
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 font-mono text-[10px] tracking-meta uppercase">
            <span className="text-success">{counts.inc} up</span>
            <span className="text-error">{counts.red} down</span>
            <span className="text-fg-secondary">{counts.nw} new</span>
            <span className="text-fg-secondary">{counts.ex} exited</span>
          </div>
        }
      >
        <div className="bg-card border border-line-subtle rounded-sm overflow-hidden">
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full border-collapse min-w-[640px]">
              <thead>
                <tr className="bg-subtle">
                  <th className="px-4 py-2 text-left font-mono text-[10px] tracking-meta uppercase text-fg-secondary">Holding</th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] tracking-meta uppercase text-fg-secondary">Sector</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] tracking-meta uppercase text-fg-secondary">{baseLabel} %</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] tracking-meta uppercase text-fg-secondary">{curLabel} %</th>
                  <th className="px-4 py-2 text-right font-mono text-[10px] tracking-meta uppercase text-fg-secondary">Δ Weight</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.name} className="border-b border-line-subtle last:border-0 hover:bg-subtle transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] text-fg-primary">{p.name}</span>
                        {p.status === "new" && (
                          <span className="font-mono text-[9px] tracking-meta uppercase text-white px-1.5 py-px rounded-sm" style={{ background: "var(--cat-7)" }}>New</span>
                        )}
                        {p.status === "exit" && (
                          <span className="font-mono text-[9px] tracking-meta uppercase text-white px-1.5 py-px rounded-sm" style={{ background: "var(--cat-2)" }}>Exit</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-fg-secondary whitespace-nowrap">{p.sector}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] text-fg-disabled tabular-nums">{p.base > 0 ? p.base.toFixed(2) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] text-fg-default tabular-nums">{p.cur > 0 ? p.cur.toFixed(2) : "—"}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Delta v={p.delta} format={(n) => n.toFixed(2)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}

function CmpKpi({ label, cur, d, fmt, base, threshold }: { label: string; cur: string; d: number; fmt: (n: number) => string; base: string; threshold?: number }) {
  return (
    <div className="bg-card border border-line-subtle rounded-sm p-4">
      <span className="font-mono text-[10px] tracking-wide2 uppercase text-fg-secondary">{label}</span>
      <div className="font-mono text-[22px] leading-tight font-medium text-fg-primary tabular-nums mt-1.5">{cur}</div>
      <div className="flex items-center gap-2 mt-1.5">
        <Delta v={d} format={fmt} threshold={threshold} />
        <span className="font-mono text-[10px] text-fg-disabled tabular-nums">from {base}</span>
      </div>
    </div>
  );
}

function DriftBar({ label, data, muted }: { label: string; data: { name: string; weight: number }[]; muted?: boolean }) {
  const total = data.reduce((a, b) => a + b.weight, 0) || 100;
  return (
    <div>
      <div className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary mb-1.5">{label}</div>
      <div className={["flex h-7 w-full rounded-sm overflow-hidden border border-line-subtle", muted ? "opacity-55" : ""].join(" ")}>
        {data.map((d, i) => {
          const pct = (d.weight / total) * 100;
          return (
            <div
              key={d.name}
              className="flex items-center justify-center min-w-0"
              style={{ width: `${pct}%`, background: catColor(i, d.name) }}
              title={`${d.name}: ${d.weight.toFixed(2)}%`}
            >
              {pct > 10 && <span className="font-mono text-[10px] font-medium text-white/95 truncate px-1 tabular-nums">{d.weight.toFixed(1)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
