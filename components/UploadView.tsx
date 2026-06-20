'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  UploadCloud,
  FileText,
  FileSpreadsheet,
  CheckCircle2,
  FileWarning,
  X,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { useFund } from '@/components/FundProvider';
import { uploadFactsheet } from '@/lib/client';
import type { UploadResult } from '@/lib/client';
import { ProgressTerminal } from '@/components/ProgressTerminal';
import { Toast } from '@/components/Toast';

type Phase = 'idle' | 'selected' | 'parsing' | 'done' | 'error';

interface SelectedFile {
  file: File;
  name: string;
  size: string;
  kind: 'pdf' | 'xls';
}

type ParseResult = UploadResult;

const UPLOAD_STEPS = [
  'reading file & checking format…',
  'extracting tabular data…',
  'detecting scheme, AMC & period…',
  'normalising holdings & ISINs…',
  'validating weights sum to 100%…',
];

const inkBtn =
  'inline-flex items-center gap-2 h-9 px-4 bg-ink text-fg-inverse font-mono text-[12px] tracking-meta uppercase rounded-sm hover:bg-ink-hover transition-colors focus-ring disabled:opacity-40';
const ghostBtn =
  'inline-flex items-center gap-2 h-9 px-3.5 bg-card border border-line-default text-fg-primary font-mono text-[12px] tracking-meta uppercase rounded-sm hover:bg-subtle transition-colors focus-ring';

function KindIcon({ kind, className }: { kind: 'pdf' | 'xls'; className?: string }) {
  const Icon = kind === 'xls' ? FileSpreadsheet : FileText;
  return <Icon className={className} strokeWidth={1.75} />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getKind(file: File): 'pdf' | 'xls' {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  return 'xls';
}

export function UploadView() {
  const { scheme, period, selectUploaded, token } = useFund();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('idle');
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function pickFile(file: File) {
    setSelectedFile({
      file,
      name: file.name,
      size: formatFileSize(file.size),
      kind: getKind(file),
    });
    setPhase('selected');
    setParseResult(null);
    setErrorMsg(null);
  }

  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setSelectedFile(null);
    setStep(0);
    setPhase('idle');
    setParseResult(null);
    setErrorMsg(null);
  }

  async function analyse() {
    if (!selectedFile) return;
    setPhase('parsing');
    setStep(0);

    // Animate steps
    let i = 0;
    const iv = setInterval(() => {
      i += 1;
      setStep(i);
      if (i >= UPLOAD_STEPS.length) clearInterval(iv);
    }, 380);

    try {
      const result = await uploadFactsheet(selectedFile.file, token, {
        scheme: scheme?.id,
        period,
        schemeName: scheme?.scheme_name,
      });
      clearInterval(iv);
      setParseResult(result);
      setPhase('done');
      setToast(`Parsed ${result.holdings_count} holdings from ${result.scheme_name} (${result.period_label}).`);
    } catch (e: unknown) {
      clearInterval(iv);
      const msg = e instanceof Error ? e.message : 'Upload failed.';
      setErrorMsg(msg);
      setPhase('error');
    }
  }

  function openAnalysis() {
    if (!parseResult) return;
    selectUploaded(
      {
        id: parseResult.scheme_id,
        scheme_name: parseResult.scheme_name,
        amc_name: parseResult.amc_name,
        category: parseResult.category,
        nav: parseResult.nav,
        asset_class: parseResult.asset_class,
      },
      parseResult.period,
    );
    router.push('/');
  }

  // ── Parsing ───────────────────────────────────────────
  if (phase === 'parsing' && selectedFile) {
    return (
      <div className="max-w-3xl mx-auto pt-8">
        <div className="border-t border-line-subtle pt-8">
          <div className="font-mono text-[10px] tracking-wide2 uppercase text-fg-secondary mb-4">
            Ingesting · {selectedFile.name}
          </div>
          <ProgressTerminal scheme="uploaded-factsheet" steps={UPLOAD_STEPS} current={step} />
        </div>
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────
  if (phase === 'done' && parseResult && selectedFile) {
    return (
      <>
        <div className="max-w-2xl mx-auto pt-8">
          <div className="border-t border-line-subtle pt-8">
            <div className="flex items-center gap-2.5 mb-5">
              <CheckCircle2 className="h-5 w-5 text-success" strokeWidth={2} />
              <h1 className="font-sans text-[26px] font-semibold tracking-tight text-fg-primary">Portfolio extracted</h1>
            </div>

            {parseResult.mismatch && (
              <div className="mb-4 bg-tint-warning border border-line-subtle rounded-sm p-3.5 flex items-start gap-2.5" data-testid="upload-mismatch">
                <FileWarning className="h-4 w-4 text-warning shrink-0 mt-0.5" strokeWidth={2} />
                <p className="text-[12.5px] text-fg-default leading-relaxed">
                  This file looks like{' '}
                  <span className="text-fg-primary font-medium">{parseResult.mismatch.detected_name}</span>
                  {parseResult.mismatch.detected_period ? ` (${parseResult.mismatch.detected_period})` : ''}
                  {parseResult.mismatch.selected_name ? (
                    <> — not the selected <span className="text-fg-primary font-medium">{parseResult.mismatch.selected_name}</span></>
                  ) : null}
                  . Showing the uploaded file&apos;s data.
                </p>
              </div>
            )}
            {parseResult.source === 'pdf' && (
              <div className="mb-4 bg-tint-info border border-line-subtle rounded-sm p-3.5 text-[12.5px] text-fg-default leading-relaxed" data-testid="upload-pdf-note">
                AI-extracted from the PDF{parseResult.partial ? ' (factsheet showed only top/summary holdings)' : ''} — verify against the official document.
              </div>
            )}

            <div className="bg-card border border-line-subtle rounded-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-subtle border-b border-line-subtle">
                <KindIcon kind={selectedFile.kind} className="h-4 w-4 text-fg-secondary" />
                <span className="font-mono text-[12px] text-fg-primary truncate">{selectedFile.name}</span>
                <span className="font-mono text-[10px] text-fg-disabled ml-auto">{selectedFile.size}</span>
              </div>
              <dl className="divide-y divide-line-subtle">
                {[
                  ['Scheme detected', parseResult.scheme_name],
                  ['Disclosure period', parseResult.period_label],
                  ['Holdings parsed', `${parseResult.holdings_count} instruments`] as [string, string],
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
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </>
    );
  }

  // ── Error ─────────────────────────────────────────────
  if (phase === 'error' && selectedFile) {
    return (
      <div className="max-w-2xl mx-auto pt-8">
        <div className="border-t border-line-subtle pt-8">
          <div className="flex items-center gap-2.5 mb-5">
            <FileWarning className="h-5 w-5 text-error" strokeWidth={2} />
            <h1 className="font-sans text-[26px] font-semibold tracking-tight text-fg-primary">Couldn&apos;t read this file</h1>
          </div>
          <div className="bg-tint-error border border-line-subtle rounded-sm p-4">
            <div className="flex items-center gap-3 mb-3">
              <KindIcon kind={selectedFile.kind} className="h-4 w-4 text-error" />
              <span className="font-mono text-[12px] text-fg-primary truncate">{selectedFile.name}</span>
              <span className="font-mono text-[10px] text-fg-disabled ml-auto">{selectedFile.size}</span>
            </div>
            <p className="text-[13px] text-fg-default leading-relaxed">
              {errorMsg ?? 'An unexpected error occurred while processing the file.'}
            </p>
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
          The escape hatch. Drop any AMC monthly portfolio — PDF or spreadsheet — and we&apos;ll parse the holdings,
          classify them, and run the same analysis, even for a fund we haven&apos;t ingested.
        </p>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xls,.xlsx,.pdf"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pickFile(f);
            // Reset input so same file can be re-selected
            e.target.value = '';
          }}
        />

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
            const f = e.dataTransfer.files[0];
            if (f) pickFile(f);
          }}
          className={[
            'mt-7 border-2 border-dashed rounded-sm px-6 py-12 text-center transition-colors',
            dragging ? 'border-primary bg-tint-info' : 'border-line-default',
          ].join(' ')}
        >
          <div className="inline-flex h-12 w-12 items-center justify-center bg-subtle border border-line-subtle rounded-sm mb-4">
            <UploadCloud className="h-6 w-6 text-fg-secondary" strokeWidth={1.75} />
          </div>
          <p className="font-mono text-[12px] tracking-meta uppercase text-fg-default">Drop a factsheet here</p>
          <p className="font-mono text-[10px] text-fg-secondary mt-1.5">accepts .pdf · .xls · .xlsx · up to 25 MB</p>
          <button onClick={() => fileInputRef.current?.click()} className={[inkBtn, 'mt-5'].join(' ')}>
            <UploadCloud className="h-4 w-4" strokeWidth={2} /> Browse files
          </button>
        </div>

        {/* Selected file */}
        {phase === 'selected' && selectedFile && (
          <div className="mt-4 bg-card border border-line-subtle rounded-sm p-3 flex items-center gap-3 flex-wrap">
            <div className="h-9 w-9 flex items-center justify-center bg-subtle border border-line-subtle rounded-sm shrink-0">
              <KindIcon kind={selectedFile.kind} className="h-4 w-4 text-fg-secondary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[12px] text-fg-primary truncate">{selectedFile.name}</div>
              <div className="font-mono text-[10px] text-fg-disabled">{selectedFile.size} · ready to parse</div>
            </div>
            <button onClick={analyse} className={inkBtn}>
              Analyse file <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </button>
            <button onClick={reset} className="text-fg-disabled hover:text-fg-primary p-1" aria-label="Remove">
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
