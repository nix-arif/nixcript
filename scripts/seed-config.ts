/**
 * Seed configuration — shared by all seed-*.ts scripts
 *
 * Contains org/user IDs and all normalization rules derived from
 * the Account Receivable (Sales) - Innosys & Affirma Excel file.
 */

// ─── Production IDs ───────────────────────────────────────────────────────────

export const ORG = {
  affirma: "9x4niIyrZTW3Vn78R54NbVkYvY0HXN0Z", // Affirma Sdn Bhd
  innosys: "g63wYhdti8elZdv8yfaU00YQ2xYpP8DU", // Smart Innosys Sdn Bhd
} as const;

export const CREATED_BY = "tF27HIE4jnnVv7lfYX4oxQE1HFC1F71I"; // nix.arif@gmail.com

export const ALL_ORG_IDS = [ORG.affirma, ORG.innosys] as const;

export const XLSX_FILE =
  "/Users/nix_arif/Downloads/Account Receivable (Sales) - Innosys & Affirma (1).xlsx";

// ─── Company → orgId ─────────────────────────────────────────────────────────

export function resolveOrgId(company: unknown): string | null {
  const c = String(company ?? "").toLowerCase().trim();
  if (c.includes("affirma")) return ORG.affirma;
  if (c.includes("innosys")) return ORG.innosys;
  return null;
}

// ─── Surgeon name normalization ───────────────────────────────────────────────
//
// Rules (applied in order):
//   1. Trim whitespace
//   2. Strip trailing/leading period from title  "Dr." → "Dr"
//   3. Merge known aliases to canonical name
//
// Result: { title, name } where name does NOT include the title prefix.

const TITLE_PREFIXES = [
  "Prof Dr", "Prof.", "Prof",
  "Dr",
  "Mr", "Ms", "Mrs", "Mdm",
  "Dato'", "Dato", "Datuk",
  "Sr", "Matron",
];

/** Explicit alias → canonical full name (title included) */
const SURGEON_ALIASES: Record<string, string> = {
  // Dr. → Dr normalization (auto-handled below, but explicit overrides win)
  "Dr. Yahya Mohd Aripin":              "Dr Yahya Mohd Aripin",
  // Title correction
  "Mr Ussof Eskaandar bin Mohd Hussain": "Dr Ussof Eskaandar bin Mohd Hussain",
};

export interface ParsedSurgeon {
  /** Normalized full string, e.g. "Dr Balraj Singh" */
  full:  string;
  /** Title portion, e.g. "Dr" | "Mr" | null */
  title: string | null;
  /** Name without title, e.g. "Balraj Singh" */
  name:  string;
}

export function normalizeSurgeon(raw: string): ParsedSurgeon {
  // Step 1: apply explicit alias map
  let s = SURGEON_ALIASES[raw.trim()] ?? raw.trim();

  // Step 2: strip period from title prefix  "Dr." → "Dr"
  s = s.replace(/^(Dr|Prof)\.\s+/, "$1 ");

  // Step 3: collapse multiple spaces
  s = s.replace(/\s{2,}/g, " ").trim();

  // Step 4: split title from name
  for (const prefix of TITLE_PREFIXES) {
    if (s.toLowerCase().startsWith(prefix.toLowerCase() + " ")) {
      return {
        full:  s,
        title: prefix,
        name:  s.slice(prefix.length + 1).trim(),
      };
    }
  }

  return { full: s, title: null, name: s };
}

// ─── Hospital name normalization ─────────────────────────────────────────────
//
// 39 unique hospitals confirmed correct as-is (no spelling fixes requested).
// Sunway branches kept separate (4 distinct sites).
// "Center" vs "Centre" spelling preserved from source file.
//
// Add entries here if a hospital is later renamed or found to be a duplicate.

/** Explicit alias → canonical hospital name */
const HOSPITAL_ALIASES: Record<string, string> = {
  // example: "Columbia Asia Cheras" : "Columbia Asia Hospital Cheras",
};

export function normalizeHospital(raw: string): string {
  const trimmed = raw.trim();
  return HOSPITAL_ALIASES[trimmed] ?? trimmed;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function str(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

export function toMoney(val: unknown): string {
  if (val == null || val === "") return "0";
  return String(val).replace(/,/g, "").trim() || "0";
}

export function toDate(val: unknown): Date | undefined {
  if (!val) return undefined;
  if (val instanceof Date) return isNaN(val.getTime()) ? undefined : val;
  const s = String(val).trim();
  // DD/MM/YY or DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const [, dd, mm, yy] = m;
    const year = yy.length === 2 ? 2000 + parseInt(yy) : parseInt(yy);
    const d = new Date(year, parseInt(mm) - 1, parseInt(dd));
    return isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

export function mapStatus(raw: string | undefined): string {
  switch ((raw ?? "").toLowerCase().trim()) {
    case "paid":        return "paid";
    case "cancelled":   return "cancelled";
    case "outstanding": return "sent";
    default:            return "draft";
  }
}
