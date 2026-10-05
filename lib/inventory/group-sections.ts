// Stock lists under the user-defined item groups. A product can be in several
// groups, but a list shows each item ONCE — under its "home" group: a
// preferred group it is in (the case type on a Case DO), else its first group
// in the users' order — and names its other groups on the row. Filtering by a
// group still finds an item through any of its groups.

export interface GroupLite { id: string; name: string; color: string | null }
export interface GroupSection<T> { key: string; name: string | null; color: string | null; items: T[] }

/** The one group an item is listed under; null = "Other" (in no group). */
export function homeGroup(ids: string[] | undefined, groups: GroupLite[], prefer: string[] = []): GroupLite | null {
  const mine = ids ?? [];
  return groups.find((g) => prefer.includes(g.id) && mine.includes(g.id)) ?? groups.find((g) => mine.includes(g.id)) ?? null;
}

/** Names of an item's groups other than the one it's listed under. */
export function otherGroupNames(ids: string[] | undefined, groups: GroupLite[], homeId: string | null | undefined): string[] {
  return groups.filter((g) => g.id !== homeId && (ids ?? []).includes(g.id)).map((g) => g.name);
}

/**
 * Items split into headings, each item once. `only`: a group id to show just
 * that group's items (under that heading), or "other" for items in no group.
 * No groups defined: one unnamed section with everything.
 */
export function groupSections<T>(items: T[], idsOf: (t: T) => string[] | undefined, groups: GroupLite[], opts: { prefer?: string[]; only?: string | null } = {}): GroupSection<T>[] {
  if (!groups.length) return [{ key: "all", name: null, color: null, items }];
  if (opts.only && opts.only !== "other") {
    const g = groups.find((x) => x.id === opts.only);
    return g ? [{ key: g.id, name: g.name, color: g.color, items: items.filter((i) => (idsOf(i) ?? []).includes(g.id)) }].filter((s) => s.items.length) : [];
  }
  const by = new Map<string, T[]>();
  for (const it of items) {
    const key = homeGroup(idsOf(it), groups, opts.prefer)?.id ?? "other";
    by.set(key, [...(by.get(key) ?? []), it]);
  }
  const secs: GroupSection<T>[] = opts.only === "other" ? [] : groups.map((g) => ({ key: g.id, name: g.name, color: g.color, items: by.get(g.id) ?? [] }));
  secs.push({ key: "other", name: "Other", color: null, items: by.get("other") ?? [] });
  return secs.filter((s) => s.items.length);
}
