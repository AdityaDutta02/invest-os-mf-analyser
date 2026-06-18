import { useState } from "react";
import { Info } from "lucide-react";

export interface KpiProps {
  label: string;
  value: string;
  hint?: string;
  tooltip?: string;
  accent?: boolean;
}

export function KpiTile({ label, value, hint, tooltip, accent }: KpiProps) {
  const [show, setShow] = useState(false);
  return (
    <div
      className={[
        "relative bg-card border border-line-subtle rounded-sm p-4 overflow-hidden",
        accent ? "pl-[15px]" : "",
      ].join(" ")}
      data-testid={`kpi-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
    >
      {accent && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary" />}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] tracking-wide2 uppercase text-fg-secondary">{label}</span>
        {tooltip && (
          <span
            className="relative inline-flex"
            onMouseEnter={() => setShow(true)}
            onMouseLeave={() => setShow(false)}
          >
            <Info className="h-3 w-3 text-fg-disabled hover:text-fg-secondary cursor-help" strokeWidth={2} />
            {show && (
              <span className="absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+6px)] z-20 w-48 bg-inverse text-fg-inverse text-[11px] leading-snug font-sans normal-case tracking-normal px-2.5 py-1.5 rounded-sm" style={{ boxShadow: "var(--shadow-3)" }}>
                {tooltip}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="font-mono text-[18px] sm:text-[22px] leading-tight font-medium text-fg-primary tabular-nums mt-1.5">
        {value}
      </div>
      {hint && <div className="text-[11px] text-fg-secondary mt-1 leading-snug">{hint}</div>}
    </div>
  );
}
