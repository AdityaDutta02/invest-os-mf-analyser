import { NavLink } from "react-router-dom";
import { LineChart, GitCompare, LayoutGrid, Upload } from "lucide-react";

const TABS = [
  { to: "/", label: "Analyse", icon: LineChart, end: true },
  { to: "/compare", label: "Compare", icon: GitCompare, end: false },
  { to: "/screen", label: "Screen", icon: LayoutGrid, end: false },
  { to: "/upload", label: "Upload", icon: Upload, end: false },
];

export function Tabs() {
  return (
    <nav className="flex items-center gap-5 sm:gap-7 overflow-x-auto scroll-thin" data-testid="view-tabs">
      {TABS.map((t) => {
        const Icon = t.icon;
        return (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            data-testid={`tab-${t.label.toLowerCase()}`}
            className={({ isActive }) =>
              [
                "group relative flex items-center gap-2 py-3.5 -mb-px border-b-2 font-mono text-[11px] uppercase tracking-meta transition-colors focus-ring shrink-0 whitespace-nowrap",
                isActive
                  ? "border-ink text-fg-primary"
                  : "border-transparent text-fg-secondary hover:text-fg-primary",
              ].join(" ")
            }
          >
            <Icon className="h-[15px] w-[15px]" strokeWidth={1.75} />
            {t.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
