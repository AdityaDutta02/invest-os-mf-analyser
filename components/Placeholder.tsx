'use client';

import { UploadCloud, GitCompare, LayoutGrid, FileText } from 'lucide-react';

export function Placeholder({
  title,
  blurb,
  phase,
  upload,
}: {
  title: string;
  blurb: string;
  phase?: boolean;
  upload?: boolean;
}) {
  const Icon = upload ? UploadCloud : title === 'Compare' ? GitCompare : LayoutGrid;
  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="bg-card border border-line-subtle rounded-sm p-10 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center bg-subtle border border-line-subtle rounded-sm mb-4">
          <Icon className="h-6 w-6 text-fg-secondary" strokeWidth={1.75} />
        </div>
        <div className="flex items-center justify-center gap-2 mb-2">
          <h2 className="font-sans text-[22px] font-medium tracking-tight text-fg-primary">{title}</h2>
          {phase && (
            <span className="font-mono text-[9px] tracking-meta uppercase text-fg-secondary border border-line-muted rounded-sm px-1.5 py-0.5">
              Phase 2
            </span>
          )}
        </div>
        <p className="text-[14px] text-fg-secondary leading-relaxed max-w-md mx-auto">{blurb}</p>

        {upload && (
          <div className="mt-6 border-2 border-dashed border-line-muted rounded-sm px-6 py-8 hover:border-primary hover:bg-tint-info transition-colors cursor-pointer">
            <FileText className="h-7 w-7 text-fg-secondary mx-auto mb-2" strokeWidth={1.5} />
            <p className="font-mono text-[12px] tracking-meta uppercase text-fg-default">Drop any MF factsheet / portfolio</p>
            <p className="font-mono text-[10px] text-fg-secondary mt-1.5">accepts .pdf · .xls · .xlsx</p>
          </div>
        )}

        <p className="font-mono text-[10px] tracking-meta uppercase text-fg-disabled mt-6">
          Wiring up next · build the Analyse view first
        </p>
      </div>
    </div>
  );
}
