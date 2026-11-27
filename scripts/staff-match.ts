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

/**
 * Zilarahim and syahidahsubari work cases as a pair. From the day syahidahsubari joined (her hire date
 * on her Smart Innosys membership, 18 Jun 2024), a case of theirs has syahidahsubari as the sales
 * person and Zilarahim as the application specialist; before it, Zilarahim alone. Other sales persons
 * on the case stay in the list.
 */
export const PAIR = { sales: "syahidahsubari", specialist: "Zilarahim" } as const;

export type CaseStaff = { sales: Staff[]; specialist: Staff | null };

/** The pair rule applied to a case's people; anything not involving the pair is returned unchanged. */
export function applyPairRule(c: CaseStaff, caseDay: string | null, pairFrom: string | null, staff: Staff[]): CaseStaff {
  const byName = (n: string) => staff.find((s) => s.name.toLowerCase() === n.toLowerCase()) ?? null;
  const sy = byName(PAIR.sales), zi = byName(PAIR.specialist);
  if (!sy || !zi || !pairFrom || !caseDay || caseDay < pairFrom) return c;
  const ids = new Set([...c.sales.map((p) => p.id), c.specialist?.id]);
  if (!ids.has(sy.id) && !ids.has(zi.id)) return c;
  const others = c.sales.filter((p) => p.id !== sy.id && p.id !== zi.id);
  return { sales: [sy, ...others], specialist: zi };
}
