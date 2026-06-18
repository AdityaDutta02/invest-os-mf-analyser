import { useState } from "react";
import { Outlet } from "react-router-dom";
import { X } from "lucide-react";
import { Header } from "./Header";
import { Tabs } from "./Tabs";
import { Footer } from "./Footer";
import { FundContextBar } from "./FundContextBar";
import { DEFAULT_SCHEME, DEFAULT_PERIOD, getPeriods } from "../lib/mock";
import type { SchemeSummary } from "../lib/mock";

export interface FundCtx {
  scheme: SchemeSummary | null;
  period: string | null;
  selectScheme: (s: SchemeSummary) => void;
  selectPeriod: (p: string) => void;
}

export function Layout() {
  const [scheme, setScheme] = useState<SchemeSummary | null>(DEFAULT_SCHEME);
  const [period, setPeriod] = useState<string | null>(DEFAULT_PERIOD);
  const [strip, setStrip] = useState(true);

  function handleScheme(s: SchemeSummary) {
    setScheme(s);
    const ps = getPeriods(s.id);
    const latest = ps.find((p) => p.hasData) ?? ps[0];
    setPeriod(latest ? latest.period : null);
  }

  const ctx: FundCtx = { scheme, period, selectScheme: handleScheme, selectPeriod: setPeriod };

  return (
    <div className="min-h-screen flex flex-col bg-page">
      {strip && (
        <div className="bg-ink text-fg-inverse">
          <div className="max-w-[1400px] 2xl:max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 h-8 flex items-center justify-center relative">
            <span className="font-mono text-[10px] tracking-meta uppercase text-white/75 text-center truncate">
              Monthly portfolio disclosure <span className="text-white/40">·</span> Not investment advice{" "}
              <span className="text-white/40">·</span> Verify against the official factsheet
            </span>
            <button
              onClick={() => setStrip(false)}
              className="absolute right-4 text-white/50 hover:text-white"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      <div className="sticky top-0 z-30 bg-card border-b border-line-subtle">
        <Header scheme={scheme} />
        <div className="border-t border-line-subtle">
          <div className="max-w-[1400px] 2xl:max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12">
            <FundContextBar
              scheme={scheme}
              period={period}
              onSelectScheme={handleScheme}
              onSelectPeriod={setPeriod}
            />
          </div>
        </div>
        <div className="border-t border-line-subtle bg-card">
          <div className="max-w-[1400px] 2xl:max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12">
            <Tabs />
          </div>
        </div>
      </div>

      <main className="flex-1 w-full">
        <div className="max-w-[1400px] 2xl:max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12 py-6 sm:py-8">
          <Outlet context={ctx} />
        </div>
      </main>

      <Footer />
    </div>
  );
}
