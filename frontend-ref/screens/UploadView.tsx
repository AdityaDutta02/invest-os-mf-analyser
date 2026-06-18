import { useEffect, useRef, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import {
  UploadCloud,
  FileText,
  FileSpreadsheet,
  CheckCircle2,
  FileWarning,
  X,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import type { FundCtx } from "../components/Layout";
import { getSchemeById } from "../lib/mock";
import { ProgressTerminal } from "../components/ProgressTerminal";

type Phase = "idle" | "selected" | "parsing" | "done" | "error";

interface Sample {
  name: string;
  size: string;
  kind: "pdf" | "xls";
  outcome: "success" | "error";
  schemeId?: string;
  detected?: { scheme: string; period: string; holdings: number; weight: string };
  reason?: string;
}

const SAMPLES: Sample[] = [
  {
    name: "PPFAS_FlexiCap_Portfolio_May2025.pdf",
    size: "1.4 MB",
    kind: "pdf",
    outcome: "success",
    schemeId: "ppfas-flexi",
    detected: { scheme: "Parag Parikh Flexi Cap Fund", period: "May 2025", holdings: 73, weight: "100.0%" },
  },
  {
    name: "HDFC_Liquid_Holdings_May2025.xlsx",
    size: "246 KB",
    kind: "xls",
    outcome: "success",
    schemeId: "hdfc-liquid",
    detected: { scheme: "HDFC Liquid Fund", period: "May 2025", holdings: 45, weight: "100.0%" },
  },
  {
    name: "Kotak_CorpBond_scan.pdf",
    size: "3.2 MB",
    kind: "pdf",
    outcome: "error",
    reason:
      "This PDF appears to be a scanned image with no embedded text layer — there are no extractable tables. Re-upload a text-based factsheet or the AMC's monthly portfolio spreadsheet.",
  },
];

const UPLOAD_STEPS = [
  "reading file & checking format…",
  "extracting tabular data…",
  "detecting scheme, AMC & period…",
  "normalising holdings & ISINs…",
  "validating weights sum to 100%…",
];

const inkBtn =
  "inline-flex items-center gap-2 h-9 px-4 bg-ink text-fg-inverse font-mono text-[12px] tracking-meta uppercase rounded-sm hover:bg-ink-hover transition-colors focus-ring disabled:opacity-40";
const ghostBtn =
  "inline-flex items-center gap-2 h-9 px-3.5 bg-card border border-line-default text-fg-primary font-mono text-[12px] tracking-meta uppercase rounded-sm hover:bg-subtle transition-colors focus-ring";

function KindIcon({ kind, className }: { kind: "pdf" | "xls"; className?: string }) {
  const Icon = kind === "xls" ? FileSpreadsheet : FileText;
  return <Icon className={className} strokeWidth={1.75} />;
}

export function UploadView() {
  const { selectScheme, selectPeriod } = useOutletContext<FundCtx>();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<Sample | null>(null);
  const [step, setStep] = useState(0);
  const [dragging, setDragging] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function pick(s: Sample) {
    setFile(s);
    setPhase("selected");
  }

  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setFile(null);
    setStep(0);
    setPhase("idle");
  }

  function analyse() {
    if (!file) return;
    setPhase("parsing");
    setStep(0);
    let i = 0;
    const iv = setInterval(() => {
      i += 1;
      setStep(i);
      if (i >= UPLOAD_STEPS.length) clearInterval(iv);
    }, 380);
    const done = setTimeout(() => {
      setPhase(file.outcome === "error" ? "error" : "done");
    }, UPLOAD_STEPS.length * 380 + 360);
    timers.current.push(done);
  }

  function openAnalysis() {
    if (!file?.schemeId) return;
    const s = getSchemeById(file.schemeId);
    if (s) {
      selectScheme(s);
      selectPeriod("2025-05");
      navigate("/");
    }
  }

  // ── Parsing ───────────────────────────────────────────
  if (phase === "parsing" && file) {
    return (
      <div className="max-w-3xl mx-auto pt-8">
        <div className="border-t border-line-subtle pt-8">
          <div className="font-mono text-[10px] tracking-wide2 uppercase text-fg-secondary mb-4">Ingesting · {file.name}</div>
          <ProgressTerminal scheme="uploaded-factsheet" steps={UPLOAD_STEPS} current={step} />
        </div>
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────
  if (phase === "done" && file?.detected) {
    const d = file.detected;
    return (
      <div className="max-w-2xl mx-auto pt-8">
        <div className="border-t border-line-subtle pt-8">
          <div className="flex items-center gap-2.5 mb-5">
            <CheckCircle2 className="h-5 w-5 text-success" strokeWidth={2} />
            <h1 className="font-sans text-[26px] font-semibold tracking-tight text-fg-primary">Portfolio extracted</h1>
          </div>
          <div className="bg-card border border-line-subtle rounded-sm overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-subtle border-b border-line-subtle">
              <KindIcon kind={file.kind} className="h-4 w-4 text-fg-secondary" />
              <span className="font-mono text-[12px] text-fg-primary truncate">{file.name}</span>
              <span className="font-mono text-[10px] text-fg-disabled ml-auto">{file.size}</span>
            </div>
            <dl className="divide-y divide-line-subtle">
              {[
                ["Scheme detected", d.scheme],
                ["Disclosure period", d.period],
                ["Holdings parsed", `${d.holdings} instruments`],
                ["Weight coverage", d.weight],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-4 py-2.5">
                  <dt className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary">{k}</dt>
                  <dd className="text-[13px] text-fg-primary font-medium tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex items-center gap-2 mt-6 flex-wrap">
            <button onClick={openAnalysis} className={inkBtn}>
              Open analysis <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </button>
            <button onClick={reset} className={ghostBtn}>
              <UploadCloud className="h-4 w-4" strokeWidth={2} /> Upload another
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────
  if (phase === "error" && file) {
    return (
      <div className="max-w-2xl mx-auto pt-8">
        <div className="border-t border-line-subtle pt-8">
          <div className="flex items-center gap-2.5 mb-5">
            <FileWarning className="h-5 w-5 text-error" strokeWidth={2} />
            <h1 className="font-sans text-[26px] font-semibold tracking-tight text-fg-primary">Couldn't read this file</h1>
          </div>
          <div className="bg-tint-error border border-line-subtle rounded-sm p-4">
            <div className="flex items-center gap-3 mb-3">
              <KindIcon kind={file.kind} className="h-4 w-4 text-error" />
              <span className="font-mono text-[12px] text-fg-primary truncate">{file.name}</span>
              <span className="font-mono text-[10px] text-fg-disabled ml-auto">{file.size}</span>
            </div>
            <p className="text-[13px] text-fg-default leading-relaxed">{file.reason}</p>
          </div>
          <div className="flex items-center gap-2 mt-6">
            <button onClick={reset} className={inkBtn}>
              <RotateCcw className="h-4 w-4" strokeWidth={2} /> Try another file
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Idle / Selected ───────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto pt-8">
      <div className="border-t border-line-subtle pt-8">
        <h1 className="font-sans text-[30px] sm:text-[36px] font-semibold tracking-tight text-fg-primary leading-tight">
          Upload a factsheet
        </h1>
        <p className="text-[14px] text-fg-secondary mt-3 leading-relaxed max-w-lg">
          The escape hatch. Drop any AMC monthly portfolio — PDF or spreadsheet — and we'll parse the holdings,
          classify them, and run the same analysis, even for a fund we haven't ingested.
        </p>

        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(SAMPLES[0]);
          }}
          className={[
            "mt-7 border-2 border-dashed rounded-sm px-6 py-12 text-center transition-colors",
            dragging ? "border-primary bg-tint-info" : "border-line-default",
          ].join(" ")}
        >
          <div className="inline-flex h-12 w-12 items-center justify-center bg-subtle border border-line-subtle rounded-sm mb-4">
            <UploadCloud className="h-6 w-6 text-fg-secondary" strokeWidth={1.75} />
          </div>
          <p className="font-mono text-[12px] tracking-meta uppercase text-fg-default">Drop a factsheet here</p>
          <p className="font-mono text-[10px] text-fg-secondary mt-1.5">accepts .pdf · .xls · .xlsx · up to 25 MB</p>
          <button onClick={() => pick(SAMPLES[0])} className={[inkBtn, "mt-5"].join(" ")}>
            <UploadCloud className="h-4 w-4" strokeWidth={2} /> Browse files
          </button>
        </div>

        {/* Selected file */}
        {phase === "selected" && file && (
          <div className="mt-4 bg-card border border-line-subtle rounded-sm p-3 flex items-center gap-3 flex-wrap">
            <div className="h-9 w-9 flex items-center justify-center bg-subtle border border-line-subtle rounded-sm shrink-0">
              <KindIcon kind={file.kind} className="h-4 w-4 text-fg-secondary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[12px] text-fg-primary truncate">{file.name}</div>
              <div className="font-mono text-[10px] text-fg-disabled">{file.size} · ready to parse</div>
            </div>
            <button onClick={analyse} className={inkBtn}>
              Analyse file <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </button>
            <button onClick={reset} className="text-fg-disabled hover:text-fg-primary p-1" aria-label="Remove">
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        )}

        {/* Sample files */}
        <div className="mt-7">
          <div className="font-mono text-[10px] tracking-wide2 uppercase text-fg-secondary mb-2.5">Or try a sample</div>
          <div className="flex flex-col gap-2">
            {SAMPLES.map((s) => (
              <button
                key={s.name}
                onClick={() => pick(s)}
                className="group flex items-center gap-3 bg-card border border-line-subtle rounded-sm px-3 py-2.5 text-left hover:border-line-default transition-colors focus-ring"
              >
                <KindIcon kind={s.kind} className="h-4 w-4 text-fg-secondary shrink-0" />
                <span className="font-mono text-[12px] text-fg-primary truncate flex-1">{s.name}</span>
                {s.outcome === "error" && (
                  <span className="font-mono text-[9px] tracking-meta uppercase text-error border border-line-muted rounded-sm px-1.5 py-px">
                    Will fail
                  </span>
                )}
                <span className="font-mono text-[10px] text-fg-disabled">{s.size}</span>
                <ArrowRight className="h-3.5 w-3.5 text-fg-disabled group-hover:text-fg-primary transition-colors shrink-0" strokeWidth={2} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
