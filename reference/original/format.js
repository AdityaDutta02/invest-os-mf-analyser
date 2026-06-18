// RECOVERED verbatim from original Emergent app sourcemap. Reference only.
// Defines number/percent/rupee formatting + the original CATEGORY_COLORS palette.
export const fmtPct = (v, opts = {}) => {
  if (v === null || v === undefined || isNaN(v)) return "—";
  const sign = opts.sign ? (v > 0 ? "+" : v < 0 ? "" : "") : "";
  const decimals = opts.decimals ?? 2;
  return `${sign}${Number(v).toFixed(decimals)}%`;
};

export const fmtPctDelta = (v, decimals = 2) => {
  if (v === null || v === undefined || isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${Number(v).toFixed(decimals)}%`;
};

export const fmtRupee = (v) => {
  if (v === null || v === undefined || isNaN(v)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
};

// Original PPFAS-flavoured category palette. Generalise category names for all funds,
// but keep this exact colour language (gold/blue/pink/green/orange/purple/grey).
export const CATEGORY_COLORS = {
  "Overseas Tech": "#EAB308",
  "Domestic IT": "#3B82F6",
  "Banking & Finance": "#EC4899",
  "FMCG": "#10B981",
  "PSU/Utilities": "#F97316",
  "REITs": "#8B5CF6",
  "Cash & Equivalents": "#71717A",
  "Others": "#22C55E",
};
