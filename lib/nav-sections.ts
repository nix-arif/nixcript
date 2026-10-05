// Which sidebar menu sections (Sales, Inventory…) the user opened or closed —
// kept in a cookie so the sidebar comes back the way they left it, read on
// the server (app/dashboard/layout.tsx) so there's no flicker on load.
export const NAV_SECTIONS_COOKIE = "nav_sections";

export function parseNavSections(raw: string | undefined): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v = JSON.parse(decodeURIComponent(raw));
    return v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, b]) => typeof b === "boolean")) as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

export function saveNavSections(sections: Record<string, boolean>) {
  document.cookie = `${NAV_SECTIONS_COOKIE}=${encodeURIComponent(JSON.stringify(sections))}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}
