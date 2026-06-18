'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LineChart, GitCompare, LayoutGrid, Upload } from 'lucide-react';

const TABS = [
  { to: '/', label: 'Analyse', icon: LineChart, exact: true },
  { to: '/compare', label: 'Compare', icon: GitCompare, exact: false },
  { to: '/screen', label: 'Screen', icon: LayoutGrid, exact: false },
  { to: '/upload', label: 'Upload', icon: Upload, exact: false },
];

export function Tabs() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-5 sm:gap-7 overflow-x-auto scroll-thin" data-testid="view-tabs">
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = t.exact ? pathname === t.to : pathname.startsWith(t.to);
        return (
          <Link
            key={t.to}
            href={t.to}
            data-testid={`tab-${t.label.toLowerCase()}`}
            className={[
              'group relative flex items-center gap-2 py-3.5 -mb-px border-b-2 font-mono text-[11px] uppercase tracking-meta transition-colors focus-ring shrink-0 whitespace-nowrap',
              isActive
                ? 'border-ink text-fg-primary'
                : 'border-transparent text-fg-secondary hover:text-fg-primary',
            ].join(' ')}
          >
            <Icon className="h-[15px] w-[15px]" strokeWidth={1.75} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
