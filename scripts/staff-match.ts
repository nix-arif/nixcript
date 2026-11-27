// The staff account a sales person's name on the case sheet stands for. The sheet writes a short
// form of the username ("Zila" for Zilarahim, "syahidah" for syahidahsubari): an alias, else the
// exact username (any case), else the one username starting with it (4+ letters, only if exactly one
// does). A label naming two people — "Hadif ( Ziyad )", "Hadif (Zurhirman)", "A & B" — is both of
// them, the first being the one on the case. Same rule as scripts/update-invoices-dos-from-sheet.ts,
// plus the aliases and the two-person labels.

export type Staff = { id: string; name: string };

/** The sheet's names for an account, where they aren't a prefix of it (lower case → username) */
export const STAFF_ALIASES: Record<string, string> = {
  zila: "Zilarahim",
  syahidah: "syahidahsubari",
};

export function staffMatcher(staff: Staff[]) {
  const one = (raw: string | null | undefined): Staff | null => {
    const v = (raw ?? "").trim().toLowerCase();
    if (!v) return null;
    const alias = STAFF_ALIASES[v];
    if (alias) return staff.find((s) => s.name.toLowerCase() === alias.toLowerCase()) ?? null;
    const exact = staff.find((s) => s.name.toLowerCase() === v);
    if (exact) return exact;
    const starts = v.length >= 4 && /^[a-z]+$/.test(v) ? staff.filter((s) => s.name.toLowerCase().startsWith(v)) : [];
    return starts.length === 1 ? starts[0] : null;
  };
  return one;
}

/**
 * Every person a sales person label names, in order ("Hadif ( Ziyad )" → Hadif, Ziyad), or null
 * when any of them has no account (the label then stays as text).
 */
export function staffListMatcher(staff: Staff[]) {
  const one = staffMatcher(staff);
  return (raw: string | null | undefined): Staff[] | null => {
    const parts = (raw ?? "").split(/[()&/,+]|\band\b/i).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    const people = parts.map(one);
    if (people.some((p) => !p)) return null;
    return [...new Map((people as Staff[]).map((p) => [p.id, p])).values()];
  };
}
