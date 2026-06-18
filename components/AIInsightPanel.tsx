'use client';

import { useState } from 'react';
import { Sparkles, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react';
import type { AIInsight } from '@/lib/types';

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function AIInsightPanel({ insight }: { insight: AIInsight }) {
  const [open, setOpen] = useState(true);
  return (
    <section
      className="bg-tint-info border border-tint-info-border rounded-sm overflow-hidden"
      data-testid="ai-insight-panel"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-tint-info-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex items-center gap-1.5 bg-primary text-primary-fg font-mono text-[10px] tracking-meta uppercase px-2 py-1 rounded-sm">
            <Sparkles className="h-3 w-3" strokeWidth={2.25} />
            AI Interpretation
          </span>
          <span className="font-mono text-[10px] tracking-meta uppercase text-fg-secondary truncate">
            generated {fmtTime(insight.generated_at)}
          </span>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 font-mono text-[10px] tracking-meta uppercase text-primary-hover hover:text-primary-pressed focus-ring rounded-sm px-1 shrink-0"
          data-testid="ai-toggle"
        >
          {open ? 'Collapse' : 'Expand'}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="px-4 py-4">
        <p className="text-[15px] leading-relaxed text-fg-primary max-w-3xl">{insight.headline}</p>

        {open && (
          <div className="mt-4 grid md:grid-cols-2 2xl:grid-cols-3 gap-x-8 gap-y-5 anim-fade-up">
            {insight.sections.map((s) => (
              <div key={s.title}>
                <h4 className="font-mono text-[10px] tracking-meta uppercase text-primary-hover mb-2">{s.title}</h4>
                <ul className="space-y-1.5">
                  {s.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-fg-default">
                      <span className="text-primary select-none mt-px shrink-0">—</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {insight.flags.length > 0 && (
              <div className="md:col-span-2 2xl:col-span-3 bg-tint-warning border-l-2 border-warning rounded-sm px-3 py-2.5">
                <h4 className="font-mono text-[10px] tracking-meta uppercase text-warning mb-1.5">Watch-outs</h4>
                <ul className="space-y-1.5">
                  {insight.flags.map((f, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-fg-default">
                      <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" strokeWidth={2} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
