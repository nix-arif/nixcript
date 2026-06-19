import * as XLSX from "xlsx";

const FILE = "/Users/nix_arif/Downloads/Account Receivable (Sales) - Innosys & Affirma.xlsx";
const wb = XLSX.readFile(FILE);
console.log("Sheets:", wb.SheetNames.join(", "));

const ws = wb.Sheets["Case Detail"];
const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
console.log(`Total rows: ${rows.length}`);
if (rows.length > 0) console.log("All columns:\n", Object.keys(rows[0]).join("\n "));
