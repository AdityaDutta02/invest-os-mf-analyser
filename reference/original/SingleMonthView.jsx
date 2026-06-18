// RECOVERED verbatim from original Emergent app sourcemap. Reference only.
// Shows exact component composition, KPI tiles, result layout, toasts, reset, cash tooltip.
import { useState } from "react";
import { toast } from "sonner";
import UploadZone from "./UploadZone";
import ProgressTerminal from "./ProgressTerminal";
import KpiTile from "./KpiTile";
import CategoryDonut from "./CategoryDonut";
import TopHoldings from "./TopHoldings";
import HoldingsTable from "./HoldingsTable";
import { Button } from "../components/ui/button";
import { analysePdf } from "../lib/api";
import { fmtPct } from "../lib/format";
import { Lightning, ArrowClockwise } from "@phosphor-icons/react";

export default function SingleMonthView() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    if (!file) {
      toast.error("Upload a PPFAS factsheet PDF to begin.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const data = await analysePdf(file);
      setResult(data);
      toast.success(`Parsed ${data.holdings_count} holdings from ${data.period_label}`);
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        "Something went wrong while parsing the PDF.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
  };

  const cashTooltip = result?.cash_breakdown?.length
    ? `Includes: ${result.cash_breakdown.map((c) => `${c.section} (${fmtPct(c.weight)})`).join(", ")}`
    : "Cash + arbitrage + money market + debt instruments combined.";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
        <UploadZone
          label="DROP PPFAS FACTSHEET PDF"
          sublabel="single month · click or drop"
          file={file}
          onFile={setFile}
          testId="single-upload"
          disabled={loading}
        />
        <div className="flex gap-2">
          <Button
            onClick={run}
            disabled={!file || loading}
            className="font-mono uppercase tracking-[0.15em] text-xs bg-[#EAB308] text-[#050505] hover:bg-[#FBBF24] rounded-none h-12 px-6 disabled:opacity-40"
            data-testid="single-analyse-btn"
          >
            <Lightning size={16} weight="fill" className="mr-2" />
            Analyse
          </Button>
          {(result || file) && (
            <Button
              onClick={reset}
              variant="outline"
              className="font-mono uppercase tracking-[0.15em] text-xs border-white/10 text-zinc-300 hover:bg-white/5 hover:text-white rounded-none h-12 px-4 bg-transparent"
              data-testid="single-reset-btn"
            >
              <ArrowClockwise size={14} weight="bold" />
            </Button>
          )}
        </div>
      </div>

      {loading && <ProgressTerminal label="ANALYSING FACTSHEET" />}

      {result && !loading && (
        <div className="space-y-6" data-testid="single-result">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiTile label="Period" value={result.period_label} hint={result.filename} testId="kpi-period" accent />
            <KpiTile label="Total Holdings" value={result.holdings_count} hint="distinct line items" testId="kpi-count" />
            <KpiTile label="Deployable Cash" value={fmtPct(result.deployable_cash)} hint="cash + arbitrage + debt + MM" tooltip={cashTooltip} testId="kpi-cash" />
            <KpiTile label="Total Weight" value={fmtPct(result.total_weight)} hint="sum of all line items" testId="kpi-total" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CategoryDonut data={result.category_breakdown} />
            <TopHoldings holdings={result.top_holdings} />
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="font-display text-xl font-bold tracking-tight text-white">All Holdings</h3>
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 font-mono">
                Sortable · click column header
              </div>
            </div>
            <HoldingsTable holdings={result.holdings} testId="single-holdings-table" />
          </div>
        </div>
      )}
    </div>
  );
}
