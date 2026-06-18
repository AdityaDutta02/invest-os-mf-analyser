'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { catColor } from '@/lib/client';
import type { WeightItem } from '@/lib/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts tooltip render prop has no exported type
function DonutTip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  return (
    <div className="bg-inverse rounded-sm px-2.5 py-1.5" style={{ boxShadow: 'var(--shadow-3)' }}>
      <div className="font-mono text-[11px] text-fg-inverse/80">{p.name}</div>
      <div className="font-mono text-[13px] font-medium text-fg-inverse tabular-nums">{Number(p.value).toFixed(2)}%</div>
    </div>
  );
}

export function CategoryDonut({
  data,
  title,
  centerLabel,
}: {
  data: WeightItem[];
  title: string;
  centerLabel: string;
}) {
  const sorted = [...data].sort((a, b) => b.weight - a.weight);
  return (
    <div className="bg-card border border-line-subtle rounded-sm p-4 h-full" data-testid="category-donut">
      <h3 className="font-mono text-[11px] tracking-wide2 uppercase text-fg-secondary mb-3">{title}</h3>
      <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5">
        <div className="relative h-[160px] w-[160px] sm:h-[176px] sm:w-[176px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={sorted}
                dataKey="weight"
                nameKey="name"
                innerRadius={56}
                outerRadius={84}
                paddingAngle={1}
                stroke="var(--surface-card)"
                strokeWidth={2}
                startAngle={90}
                endAngle={-270}
              >
                {sorted.map((d, i) => (
                  <Cell key={d.name} fill={catColor(i, d.name)} />
                ))}
              </Pie>
              <Tooltip content={<DonutTip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="font-mono text-[22px] font-medium text-fg-primary leading-none tabular-nums">
              {sorted.length}
            </span>
            <span className="font-mono text-[9px] tracking-meta uppercase text-fg-secondary mt-1">{centerLabel}</span>
          </div>
        </div>
        <ul className="flex-1 w-full grid grid-cols-1 gap-y-1.5 min-w-0">
          {sorted.map((d, i) => (
            <li key={d.name} className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: catColor(i, d.name) }} />
              <span className="text-[12.5px] text-fg-default flex-1 truncate">{d.name}</span>
              <span className="font-mono text-[12px] text-fg-secondary tabular-nums">{d.weight.toFixed(2)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
