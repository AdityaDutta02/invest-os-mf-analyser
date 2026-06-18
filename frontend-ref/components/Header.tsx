import { BarChart3 } from "lucide-react";
import type { SchemeSummary } from "../lib/mock";

export function Header({ scheme }: { scheme: SchemeSummary | null }) {
  return (
    <div className="max-w-[1400px] 2xl:max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 2xl:px-12">
      <div className="flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-7 w-7 bg-ink flex items-center justify-center shrink-0 rounded-sm">
            <BarChart3 className="h-4 w-4 text-fg-inverse" strokeWidth={2.25} />
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-[13px] font-medium tracking-wide2 text-fg-primary uppercase whitespace-nowrap">
              Factsheet Analyser
            </span>
            {scheme && (
              <span className="font-mono text-[11px] text-fg-secondary truncate hidden md:inline">
                <span className="text-fg-disabled">/</span> {scheme.category}{" "}
                <span className="text-fg-disabled">/</span> {scheme.scheme_name}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          <span className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary">
            Live <span className="text-fg-disabled">·</span> v1.0
          </span>
        </div>
      </div>
    </div>
  );
}
