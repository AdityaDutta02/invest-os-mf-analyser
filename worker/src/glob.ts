// Converts amc-registry.json's `link_match` patterns (a mix of `*` wildcards
// and `{Placeholder}` tokens, e.g. "Monthly-Portfolio-Disclosure-{Month}-{YYYY}.zip")
// into a loose, case-insensitive regex tested against link basenames.
// Deliberately loose: the registry field exists to document AMC-specific
// naming, not to pin an exact match — false positives are cheap (the
// downloaded file still has to parse through lib/parse.ts's validation
// gate downstream), false negatives (missing a real month) are not.
export function linkMatchToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^$()|[\]\\]/g, "\\$&");
  const withPlaceholders = escaped.replace(/\{[^}]*\}/g, ".*");
  const withWildcards = withPlaceholders.replace(/\*/g, ".*");
  return new RegExp(withWildcards, "i");
}
