import * as XLSX from "xlsx";

const wb = XLSX.readFile("/Users/nix_arif/Downloads/Account Receivable (Sales) - Innosys & Affirma (1).xlsx");
const ws = wb.Sheets["Case Detail"];
const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });

console.log("Columns:", Object.keys(rows[0] ?? {}).join(" | "));

console.log("\nSample rows:");
rows.slice(0, 5).forEach((r, i) => {
  console.log(`\n[${i+1}]`);
  const keys = ["INVOICE NO","INVOICE DATE","STATUS","PAYMENT DATE","PAYMENT REF","TOTAL SO","COMPANY","LPO","SALES ORDER NO","INNOSYS BILL TO AFFIRMA","HOSPITAL","SURGEON","DATE","CASE","TIME","MRN NO","ATTEND COMMISSION CLAIM BY","DOCS","COMMISSION AMOUNT","SURGEON COMMISSION","PAYMENT DATE_1","SOA Status","Incentive","Actual Amount"];
  keys.forEach(k => console.log(`  ${k.padEnd(28)}: ${r[k]}`));
});

const validRows = rows.filter(r => String(r["INVOICE NO"] ?? "").trim());
console.log("\nTotal invoice rows:", validRows.length);

const statusCounts: Record<string, number> = {};
for (const r of validRows) {
  const s = String(r["STATUS"] ?? "").trim() || "(empty)";
  statusCounts[s] = (statusCounts[s] ?? 0) + 1;
}
console.log("Status breakdown:", statusCounts);

const soaVals = new Set(validRows.map(r => String(r["SOA Status"] ?? "").trim() || "(empty)"));
console.log("SOA Status values:", [...soaVals]);

const billToVals = new Set(validRows.map(r => String(r["INNOSYS BILL TO AFFIRMA"] ?? "").trim()).filter(Boolean));
console.log("BILL TO values:", [...billToVals].slice(0, 10));
