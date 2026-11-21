// The invoice list's date filter: a range of calendar days in Malaysia time (UTC+8, no daylight saving).
// No database here, so the list page and the server use the same rules.
//
// An invoice date is stored as a UTC timestamp: the date picked on the form is saved as midnight UTC of that day,
// one created automatically as the moment it was made. Both fall on the right Malaysian day when the range runs from
// 00:00 to 24:00 Malaysia time, which is also the date the list shows.

export type DayRange = { from: string | null; to: string | null }; // "YYYY-MM-DD", either end may be open

const KL_OFFSET_MS = 8 * 60 * 60 * 1000;

// "2026-11-21" when it is a real calendar day, else null ("2026-02-30", "21/11/2026", "" ...)
export function parseDay(s: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : null;
}

// a valid range from what was in the URL; the ends are swapped when from is after to
export function normalizeRange(from: string | null | undefined, to: string | null | undefined): DayRange {
  let f = parseDay(from), t = parseDay(to);
  if (f && t && f > t) [f, t] = [t, f];
  return { from: f, to: t };
}

export const hasRange = (r: DayRange) => !!(r.from || r.to);

// the moment a Malaysian day starts, as a UTC Date
export const klDayStart = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - KL_OFFSET_MS);

// the database bounds: invoiceDate >= gte and invoiceDate < lt (the day after "to", so all of "to" is included)
export function rangeBounds(r: DayRange): { gte: Date | null; lt: Date | null } {
  return {
    gte: r.from ? klDayStart(r.from) : null,
    lt: r.to ? new Date(klDayStart(r.to).getTime() + 24 * 60 * 60 * 1000) : null,
  };
}

// today's date in Malaysia, "YYYY-MM-DD"
export const todayKL = (now: Date = new Date()) => new Date(now.getTime() + KL_OFFSET_MS).toISOString().slice(0, 10);

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10); // m is 0-based, overflow allowed

export const PRESETS = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "this-quarter", label: "This quarter" },
  { key: "this-year", label: "This year" },
  { key: "last-year", label: "Last year" },
] as const;
export type PresetKey = (typeof PRESETS)[number]["key"];

export function presetRange(key: PresetKey, now: Date = new Date()): DayRange {
  const [y, m] = todayKL(now).split("-").map(Number); // m is 1-based here
  const mi = m - 1;
  switch (key) {
    case "this-month":   return { from: ymd(y, mi, 1), to: ymd(y, mi + 1, 0) };
    case "last-month":   return { from: ymd(y, mi - 1, 1), to: ymd(y, mi, 0) };
    case "this-quarter": { const q = Math.floor(mi / 3) * 3; return { from: ymd(y, q, 1), to: ymd(y, q + 3, 0) }; }
    case "this-year":    return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last-year":    return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  }
}

// which preset a range is exactly, if any (to highlight it)
export function matchPreset(r: DayRange, now: Date = new Date()): PresetKey | null {
  for (const p of PRESETS) {
    const pr = presetRange(p.key, now);
    if (pr.from === r.from && pr.to === r.to) return p.key;
  }
  return null;
}

// "1 Nov 2026 – 30 Nov 2026", "From 1 Nov 2026", "Up to 30 Nov 2026"
export function describeRange(r: DayRange): string {
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  if (r.from && r.to) return r.from === r.to ? f(r.from) : `${f(r.from)} – ${f(r.to)}`;
  if (r.from) return `From ${f(r.from)}`;
  if (r.to) return `Up to ${f(r.to)}`;
  return "All dates";
}
