"use client";

import { useEffect } from "react";
import { getQuotationGroupForPrint } from "@/server/quotation";

type GroupItem = NonNullable<
  Awaited<ReturnType<typeof getQuotationGroupForPrint>>
>[number];

interface Props {
  group: GroupItem[];
}

const fmtDate = (d: Date | string | null | undefined, short = false) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-MY", short
    ? { month: "short", year: "numeric" }
    : { day: "2-digit", month: "long", year: "numeric" });
};

const fmtMoney = (v: string | number | null | undefined) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

// ── Template: Corporate ────────────────────────────────────────────────────
// Classic layout — header with logo/company left, quotation no. right,
// two-col info row, bordered table.
function TemplateCorporate({ entry }: { entry: GroupItem }) {
  const { quotation: q, items, orgName, orgLogoUrl, orgBrandColor,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgPhone, orgBankingInfo } = entry;
  const cust = q.customerSnapshot as any;
  const primary = orgBrandColor ?? "#1e3a5f";
  
  const showTP = !!Number(q.showTotalPrice);
  const subtotal = Number(q.subtotal ?? 0);
  const discAmt = Number(q.overallDiscountAmt ?? 0);
  const sstAmt = Number(q.sst ?? 0);
  const grand = Number(q.grandTotal ?? 0);
  const afterDisc = subtotal - discAmt;
  const bank = (orgBankingInfo as any[]).find(b => b.isPrimary) ?? (orgBankingInfo as any[])[0] ?? null;

  return (
    <div style={{ background: "white", width: "100%", fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: "12px", color: "#1a1a1a" }}>
      {/* Top accent bar */}
      <div style={{ height: "5px", background: primary }} />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "20px 28px 16px" }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          {orgLogoUrl
            ? <img src={orgLogoUrl} alt="" style={{ height: "44px", width: "auto", objectFit: "contain" }} />
            : <div style={{ width: "44px", height: "44px", background: primary, borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: "700", fontSize: "16px" }}>
                {(orgCompanyName ?? orgName).slice(0, 2).toUpperCase()}
              </div>
          }
          <div>
            <div style={{ fontWeight: "700", fontSize: "15px", color: primary }}>{orgCompanyName ?? orgName}</div>
            {orgCompanyAddress && <div style={{ color: "#666", fontSize: "10.5px", marginTop: "2px", maxWidth: "280px" }}>{orgCompanyAddress}</div>}
            {(orgTaxNo || orgPhone) && (
              <div style={{ color: "#888", fontSize: "10px", marginTop: "1px" }}>
                {[orgTaxNo && `Tax: ${orgTaxNo}`, orgPhone].filter(Boolean).join("  ·  ")}
              </div>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "11px", color: "#888", textTransform: "uppercase", letterSpacing: "1.5px" }}>Quotation</div>
          <div style={{ fontWeight: "700", fontSize: "17px", fontFamily: "monospace", color: primary, marginTop: "2px" }}>{q.quotationNo}</div>
          <div style={{ fontSize: "11px", color: "#555", marginTop: "6px" }}>
            <div style={{ color: "#888" }}>Title: <span style={{ color: "#333" }}>{q.title ?? "Loose Items"}</span></div>
            <div>Date: {fmtDate(q.createdAt)}</div>
            <div>Valid: {fmtDate(q.validUntil)}</div>
          </div>
        </div>
      </div>

      {/* Info row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", margin: "0 28px 16px", border: `1px solid ${primary}30`, borderRadius: "6px", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderRight: `1px solid ${primary}20` }}>
          <div style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1px", color: primary, marginBottom: "6px" }}>Attention To</div>
          {cust ? (
            <div style={{ lineHeight: "1.6" }}>
              <div style={{ fontWeight: "600" }}>{[cust.title, cust.name].filter(Boolean).join(" ")}</div>
              {cust.position && <div style={{ color: "#555" }}>{cust.position}{cust.department ? `, ${cust.department}` : ""}</div>}
              {cust.organizationName && <div style={{ color: "#555" }}>{cust.organizationName}</div>}
              {cust.organizationAddress && <div style={{ color: "#777", fontSize: "10.5px" }}>{cust.organizationAddress}</div>}
              {(cust.email || cust.contactNo) && <div style={{ color: "#777", fontSize: "10.5px" }}>{[cust.email, cust.contactNo].filter(Boolean).join("  ·  ")}</div>}
            </div>
          ) : <div style={{ color: "#999" }}>—</div>}
        </div>
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1px", color: primary, marginBottom: "6px" }}>Details</div>
          <table style={{ fontSize: "11px", borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {[["Sales Person", q.salesPersonName ?? "—"], ["Prepared By", q.preparedByName ?? "—"]].map(([l, v]) => (
                <tr key={l}><td style={{ color: "#777", paddingRight: "10px", paddingBottom: "2px", whiteSpace: "nowrap" }}>{l}</td><td style={{ fontWeight: "500" }}>{v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Items */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
        <thead>
          <tr style={{ background: primary }}>
            {["#", "Code", "Description / MDA", "Qty", "UOM", "Unit Price", "Disc%", ...(showTP ? ["Total"] : [])].map(h => (
              <th key={h} style={{ padding: "8px 10px", color: "white", fontWeight: "600", textAlign: ["Unit Price","Total","#"].includes(h) ? "right" : "left", fontSize: "10px", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id} style={{ background: i % 2 === 0 ? "white" : `${primary}07`, borderBottom: `1px solid ${primary}15` }}>
              <td style={{ padding: "7px 10px", color: "#999", textAlign: "right", width: "24px" }}>{item.rowNo}</td>
              <td style={{ padding: "7px 10px", fontFamily: "monospace", fontSize: "10px", whiteSpace: "nowrap" }}>{item.productCode ?? "—"}</td>
              <td style={{ padding: "7px 10px" }}>
                <div style={{ fontWeight: "500" }}>{item.description ?? "—"}</div>
                {item.hasCert && item.mdaRegNo && <div style={{ fontSize: "9.5px", color: "#5a8a5a", marginTop: "1px" }}>MDA: {item.mdaRegNo}{item.mdaValidity ? ` · Exp: ${fmtDate(item.mdaValidity, true)}` : ""}</div>}
                {!item.hasCert && <div style={{ fontSize: "9.5px", color: "#cc8800", marginTop: "1px" }}>No MDA certificate</div>}
              </td>
              <td style={{ padding: "7px 10px", textAlign: "center" }}>{item.qty}</td>
              <td style={{ padding: "7px 10px", color: "#666", textAlign: "center" }}>{item.uom || "—"}</td>
              <td style={{ padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>RM {Number(item.unitPrice ?? 0).toFixed(2)}</td>
              <td style={{ padding: "7px 10px", textAlign: "center", color: "#666" }}>{Number(item.discountPct ?? 0) > 0 ? `${item.discountPct}%` : "—"}</td>
              {showTP && <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>RM {Number(item.totalPrice ?? 0).toFixed(2)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals + bank */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 28px", borderTop: `2px solid ${primary}20` }}>
        {bank ? (
          <div style={{ fontSize: "11px" }}>
            <div style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1px", color: primary, marginBottom: "6px" }}>Payment To</div>
            {[["Bank", bank.bankName], ["Account", bank.accountHolder], ["Account No.", bank.accountNo]].map(([l, v]) => (
              <div key={l} style={{ color: "#555", marginBottom: "1px" }}><span style={{ color: "#888", marginRight: "6px" }}>{l}:</span>{v}</div>
            ))}
          </div>
        ) : <div />}
        <div style={{ minWidth: "200px" }}>
          {[[`Subtotal`, fmtMoney(subtotal)], ...(discAmt > 0 ? [[`Discount (${q.overallDiscountPct}%)`, `- ${fmtMoney(discAmt)}`], [`After Discount`, fmtMoney(afterDisc)]] : []), ...(sstAmt > 0 ? [[`SST (${q.sstPct}%)`, fmtMoney(sstAmt)]] : [])].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "3px" }}>
              <span style={{ color: "#666", marginRight: "16px" }}>{l}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", paddingTop: "8px", borderTop: `2px solid ${primary}` }}>
            <span style={{ fontWeight: "700", color: primary }}>Grand Total</span>
            <span style={{ fontWeight: "700", fontSize: "14px", color: primary, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(grand)}</span>
          </div>
        </div>
      </div>

      {q.notes && (
        <div style={{ margin: "0 28px 14px", padding: "10px 14px", background: `${primary}08`, borderLeft: `3px solid ${primary}`, borderRadius: "0 4px 4px 0", fontSize: "11px", color: "#444" }}>
          <div style={{ fontSize: "9px", fontWeight: "700", color: primary, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>Notes</div>
          {q.notes}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 28px 16px", borderTop: `1px solid #e5e5e5`, fontSize: "10px", color: "#aaa" }}>
        <span><span style={{ color: "#555", fontWeight: "500" }}>Computer generated document.</span> No signature required.</span>
        <span>{q.quotationNo} · {new Date().toLocaleDateString("en-MY")}</span>
      </div>
    </div>
  );
}

// ── Template: Modern ──────────────────────────────────────────────────────
// Full-width dark header, quotation no as hero, borderless table.
function TemplateModern({ entry }: { entry: GroupItem }) {
  const { quotation: q, items, orgName, orgLogoUrl, orgBrandColor,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgPhone, orgBankingInfo } = entry;
  const cust = q.customerSnapshot as any;
  const primary = orgBrandColor ?? "#064e3b";
  
  const showTP = !!Number(q.showTotalPrice);
  const subtotal = Number(q.subtotal ?? 0);
  const discAmt = Number(q.overallDiscountAmt ?? 0);
  const sstAmt = Number(q.sst ?? 0);
  const grand = Number(q.grandTotal ?? 0);
  const afterDisc = subtotal - discAmt;
  const bank = (orgBankingInfo as any[]).find(b => b.isPrimary) ?? (orgBankingInfo as any[])[0] ?? null;

  return (
    <div style={{ background: "white", width: "100%", fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: "12px", color: "#1a1a1a" }}>
      {/* Full-width dark header */}
      <div style={{ background: primary, padding: "28px 32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
              {orgLogoUrl
                ? <img src={orgLogoUrl} alt="" style={{ height: "40px", width: "auto", objectFit: "contain", background: "white", borderRadius: "4px", padding: "3px 6px" }} />
                : <div style={{ width: "40px", height: "40px", background: "rgba(255,255,255,0.15)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: "700", fontSize: "14px" }}>
                    {(orgCompanyName ?? orgName).slice(0, 2).toUpperCase()}
                  </div>
              }
              <div style={{ color: "white" }}>
                <div style={{ fontWeight: "700", fontSize: "16px" }}>{orgCompanyName ?? orgName}</div>
                {orgCompanyAddress && <div style={{ fontSize: "10.5px", opacity: 0.7, marginTop: "1px" }}>{orgCompanyAddress}</div>}
                {(orgTaxNo || orgPhone) && <div style={{ fontSize: "10px", opacity: 0.6, marginTop: "1px" }}>{[orgTaxNo && `Tax: ${orgTaxNo}`, orgPhone].filter(Boolean).join("  ·  ")}</div>}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "2px" }}>Quotation</div>
            <div style={{ color: "white", fontWeight: "800", fontSize: "22px", fontFamily: "monospace", letterSpacing: "1px", marginTop: "2px" }}>{q.quotationNo}</div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px", marginTop: "4px" }}>{q.title ?? "Loose Items"}</div>
          </div>
        </div>

        {/* Meta strip inside header */}
        <div style={{ display: "flex", gap: "24px", marginTop: "14px", paddingTop: "14px", borderTop: "1px solid rgba(255,255,255,0.15)" }}>
          {[["Date", fmtDate(q.createdAt)], ["Valid Until", fmtDate(q.validUntil)], ["Sales Person", q.salesPersonName ?? "—"], ["Prepared By", q.preparedByName ?? "—"]].map(([l, v]) => (
            <div key={l}>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.8px" }}>{l}</div>
              <div style={{ color: "white", fontSize: "11px", fontWeight: "500", marginTop: "1px" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Attention To */}
      <div style={{ padding: "18px 32px 0" }}>
        <div style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1px", color: primary, marginBottom: "6px" }}>Attention To</div>
        {cust ? (
          <div style={{ display: "flex", gap: "32px" }}>
            <div style={{ lineHeight: "1.7" }}>
              <div style={{ fontWeight: "700", fontSize: "13px" }}>{[cust.title, cust.name].filter(Boolean).join(" ")}</div>
              {cust.position && <div style={{ color: "#555" }}>{cust.position}{cust.department ? `, ${cust.department}` : ""}</div>}
              {cust.organizationName && <div style={{ color: "#555" }}>{cust.organizationName}</div>}
            </div>
            {(cust.organizationAddress || cust.email || cust.contactNo) && (
              <div style={{ color: "#666", fontSize: "11px", lineHeight: "1.7" }}>
                {cust.organizationAddress && <div>{cust.organizationAddress}</div>}
                {(cust.email || cust.contactNo) && <div>{[cust.email, cust.contactNo].filter(Boolean).join("  ·  ")}</div>}
              </div>
            )}
          </div>
        ) : <div style={{ color: "#999" }}>—</div>}
      </div>

      {/* Items — borderless rows */}
      <div style={{ margin: "18px 32px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: `28px 90px 1fr 44px 48px 80px 44px${showTP ? " 90px" : ""}`, borderBottom: `2px solid ${primary}`, paddingBottom: "6px", marginBottom: "2px" }}>
          {["#", "Code", "Description / MDA", "Qty", "UOM", "Unit Price", "Disc", ...(showTP ? ["Total"] : [])].map((h, i) => (
            <div key={h} style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.8px", color: primary, textAlign: ["Unit Price","Total","#"].includes(h) ? "right" : "left", paddingRight: i === 1 ? "8px" : "0" }}>{h}</div>
          ))}
        </div>
        {items.map((item, i) => (
          <div key={item.id} style={{ display: "grid", gridTemplateColumns: `28px 90px 1fr 44px 48px 80px 44px${showTP ? " 90px" : ""}`, padding: "7px 0", borderBottom: "1px solid #f0f0f0", alignItems: "start" }}>
            <div style={{ color: "#bbb", textAlign: "right", paddingRight: "8px", paddingTop: "1px", fontSize: "10px" }}>{item.rowNo}</div>
            <div style={{ fontFamily: "monospace", fontSize: "10px", color: "#555", paddingRight: "8px", paddingTop: "1px" }}>{item.productCode ?? "—"}</div>
            <div>
              <div style={{ fontWeight: "500" }}>{item.description ?? "—"}</div>
              {item.hasCert && item.mdaRegNo && <div style={{ fontSize: "9.5px", color: "#059669", marginTop: "1px" }}>MDA: {item.mdaRegNo}{item.mdaValidity ? ` · Exp: ${fmtDate(item.mdaValidity, true)}` : ""}</div>}
              {!item.hasCert && <div style={{ fontSize: "9.5px", color: "#d97706", marginTop: "1px" }}>No MDA certificate</div>}
            </div>
            <div style={{ textAlign: "center", color: "#333" }}>{item.qty}</div>
            <div style={{ textAlign: "center", color: "#888" }}>{item.uom || "—"}</div>
            <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>RM {Number(item.unitPrice ?? 0).toFixed(2)}</div>
            <div style={{ textAlign: "center", color: "#888" }}>{Number(item.discountPct ?? 0) > 0 ? `${item.discountPct}%` : "—"}</div>
            {showTP && <div style={{ textAlign: "right", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>RM {Number(item.totalPrice ?? 0).toFixed(2)}</div>}
          </div>
        ))}
      </div>

      {/* Totals + bank */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "16px 32px 0" }}>
        {bank ? (
          <div style={{ fontSize: "11px" }}>
            <div style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1px", color: primary, marginBottom: "5px" }}>Payment To</div>
            {[["Bank", bank.bankName], ["Account", bank.accountHolder], ["Acc No.", bank.accountNo]].map(([l, v]) => (
              <div key={l} style={{ marginBottom: "1px" }}><span style={{ color: "#888", marginRight: "6px" }}>{l}:</span><span style={{ fontWeight: "500" }}>{v}</span></div>
            ))}
          </div>
        ) : <div />}
        <div>
          {[[`Subtotal`, fmtMoney(subtotal)], ...(discAmt > 0 ? [[`Discount (${q.overallDiscountPct}%)`, `- ${fmtMoney(discAmt)}`], [`After Discount`, fmtMoney(afterDisc)]] : []), ...(sstAmt > 0 ? [[`SST (${q.sstPct}%)`, fmtMoney(sstAmt)]] : [])].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: "24px", fontSize: "11px", color: "#666", marginBottom: "3px" }}>
              <span>{l}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
            </div>
          ))}
          <div style={{ marginTop: "10px", background: primary, borderRadius: "6px", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "24px" }}>
            <span style={{ color: "rgba(255,255,255,0.8)", fontWeight: "600", fontSize: "12px" }}>Grand Total</span>
            <span style={{ color: "white", fontWeight: "800", fontSize: "16px", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(grand)}</span>
          </div>
        </div>
      </div>

      {q.notes && (
        <div style={{ margin: "14px 32px 0", padding: "10px 14px", borderLeft: `3px solid ${primary}`, fontSize: "11px", color: "#444" }}>
          <div style={{ fontSize: "9px", fontWeight: "700", color: primary, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "3px" }}>Notes</div>
          {q.notes}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", margin: "14px 32px 20px", paddingTop: "12px", borderTop: `1px solid #eee`, fontSize: "10px", color: "#aaa" }}>
        <span><span style={{ color: "#555", fontWeight: "500" }}>Computer generated document.</span> No signature required.</span>
        <span>{q.quotationNo} · {new Date().toLocaleDateString("en-MY")}</span>
      </div>
    </div>
  );
}

// ── Template: Bold ────────────────────────────────────────────────────────
// Geometric dark header, high-contrast striped table, accent total box.
function TemplateBold({ entry }: { entry: GroupItem }) {
  const { quotation: q, items, orgName, orgLogoUrl, orgBrandColor,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgPhone, orgBankingInfo } = entry;
  const cust = q.customerSnapshot as any;
  const primary = orgBrandColor ?? "#581c87";
  
  const showTP = !!Number(q.showTotalPrice);
  const subtotal = Number(q.subtotal ?? 0);
  const discAmt = Number(q.overallDiscountAmt ?? 0);
  const sstAmt = Number(q.sst ?? 0);
  const grand = Number(q.grandTotal ?? 0);
  const afterDisc = subtotal - discAmt;
  const bank = (orgBankingInfo as any[]).find(b => b.isPrimary) ?? (orgBankingInfo as any[])[0] ?? null;

  return (
    <div style={{ background: "white", width: "100%", fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: "12px", color: "#1a1a1a" }}>
      {/* Dark header with diagonal accent */}
      <div style={{ background: "#111", position: "relative", overflow: "hidden" }}>
        {/* Accent diagonal stripe */}
        <div style={{ position: "absolute", top: 0, right: 0, width: "180px", height: "100%", background: primary, clipPath: "polygon(40px 0, 100% 0, 100% 100%, 0% 100%)" }} />

        <div style={{ position: "relative", zIndex: 1, padding: "22px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {orgLogoUrl
              ? <img src={orgLogoUrl} alt="" style={{ height: "46px", width: "auto", objectFit: "contain", filter: "brightness(0) invert(1)" }} />
              : <div style={{ width: "46px", height: "46px", background: "rgba(255,255,255,0.1)", border: "2px solid rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: "800", fontSize: "16px" }}>
                  {(orgCompanyName ?? orgName).slice(0, 2).toUpperCase()}
                </div>
            }
            <div>
              <div style={{ color: "white", fontWeight: "800", fontSize: "17px", letterSpacing: "-0.3px" }}>{orgCompanyName ?? orgName}</div>
              {orgCompanyAddress && <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "10.5px", marginTop: "2px" }}>{orgCompanyAddress}</div>}
              {(orgTaxNo || orgPhone) && <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "10px", marginTop: "1px" }}>{[orgTaxNo && `Tax: ${orgTaxNo}`, orgPhone].filter(Boolean).join("  ·  ")}</div>}
            </div>
          </div>
          <div style={{ textAlign: "right", zIndex: 2 }}>
            <div style={{ color: "white", fontWeight: "800", fontSize: "20px", fontFamily: "monospace", letterSpacing: "0.5px" }}>{q.quotationNo}</div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px", fontWeight: "600", marginTop: "2px" }}>{q.title ?? "Loose Items"}</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "10px", marginTop: "3px" }}>{fmtDate(q.createdAt)} — {fmtDate(q.validUntil)}</div>
          </div>
        </div>
      </div>

      {/* Accent rule */}
      <div style={{ height: "4px", background: `linear-gradient(to right, ${primary}, #111)` }} />

      {/* Info boxes */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "#e5e5e5", margin: "0" }}>
        <div style={{ background: "white", padding: "14px 20px" }}>
          <div style={{ fontSize: "9px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "1.2px", color: primary, marginBottom: "7px" }}>Attention To</div>
          {cust ? (
            <div style={{ lineHeight: "1.65" }}>
              <div style={{ fontWeight: "700", fontSize: "13px" }}>{[cust.title, cust.name].filter(Boolean).join(" ")}</div>
              {cust.position && <div style={{ color: "#444" }}>{cust.position}{cust.department ? `, ${cust.department}` : ""}</div>}
              {cust.organizationName && <div style={{ color: "#444" }}>{cust.organizationName}</div>}
              {cust.organizationAddress && <div style={{ color: "#666", fontSize: "10.5px" }}>{cust.organizationAddress}</div>}
              {(cust.email || cust.contactNo) && <div style={{ color: "#666", fontSize: "10.5px" }}>{[cust.email, cust.contactNo].filter(Boolean).join("  ·  ")}</div>}
            </div>
          ) : <div style={{ color: "#999" }}>—</div>}
        </div>
        <div style={{ background: "#fafafa", padding: "14px 20px" }}>
          <div style={{ fontSize: "9px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "1.2px", color: primary, marginBottom: "7px" }}>Quotation Info</div>
          <table style={{ fontSize: "11.5px", borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {[["Sales Person", q.salesPersonName ?? "—"], ["Prepared By", q.preparedByName ?? "—"], ["Issue Date", fmtDate(q.createdAt)], ["Valid Until", fmtDate(q.validUntil)]].map(([l, v]) => (
                <tr key={l}>
                  <td style={{ color: "#777", paddingRight: "12px", paddingBottom: "3px", whiteSpace: "nowrap" }}>{l}</td>
                  <td style={{ fontWeight: "600", color: "#111" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Items */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", marginTop: "1px" }}>
        <thead>
          <tr style={{ background: "#111" }}>
            {["#", "Code", "Description / MDA", "Qty", "UOM", "Unit Price", "Disc%", ...(showTP ? ["Total"] : [])].map(h => (
              <th key={h} style={{ padding: "8px 10px", color: h === "#" ? "#666" : "white", fontWeight: "700", textAlign: ["Unit Price","Total"].includes(h) ? "right" : h === "#" ? "center" : "left", fontSize: "9.5px", textTransform: "uppercase", letterSpacing: "0.5px", borderLeft: h === "Description / MDA" ? `3px solid ${primary}` : "none" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id} style={{ background: i % 2 === 0 ? "white" : "#f7f7f9", borderBottom: "1px solid #ebebeb" }}>
              <td style={{ padding: "7px 10px", color: "#bbb", textAlign: "center", fontSize: "10px" }}>{item.rowNo}</td>
              <td style={{ padding: "7px 10px", fontFamily: "monospace", fontSize: "10px", color: "#555" }}>{item.productCode ?? "—"}</td>
              <td style={{ padding: "7px 10px", borderLeft: `3px solid ${primary}30` }}>
                <div style={{ fontWeight: "600" }}>{item.description ?? "—"}</div>
                {item.hasCert && item.mdaRegNo && <div style={{ fontSize: "9.5px", color: "#15803d", marginTop: "1px" }}>MDA: {item.mdaRegNo}{item.mdaValidity ? ` · Exp: ${fmtDate(item.mdaValidity, true)}` : ""}</div>}
                {!item.hasCert && <div style={{ fontSize: "9.5px", color: "#b45309", marginTop: "1px" }}>No MDA certificate</div>}
              </td>
              <td style={{ padding: "7px 10px", textAlign: "center" }}>{item.qty}</td>
              <td style={{ padding: "7px 10px", textAlign: "center", color: "#777" }}>{item.uom || "—"}</td>
              <td style={{ padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>RM {Number(item.unitPrice ?? 0).toFixed(2)}</td>
              <td style={{ padding: "7px 10px", textAlign: "center", color: "#888" }}>{Number(item.discountPct ?? 0) > 0 ? `${item.discountPct}%` : "—"}</td>
              {showTP && <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: "700", fontVariantNumeric: "tabular-nums" }}>RM {Number(item.totalPrice ?? 0).toFixed(2)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals + bank */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "16px 20px" }}>
        {bank ? (
          <div style={{ fontSize: "11px", padding: "10px 14px", background: "#f7f7f9", border: "1px solid #e5e5e5", borderRadius: "4px" }}>
            <div style={{ fontSize: "9px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "1px", color: primary, marginBottom: "5px" }}>Payment To</div>
            {[["Bank", bank.bankName], ["Account", bank.accountHolder], ["Acc No.", bank.accountNo]].map(([l, v]) => (
              <div key={l} style={{ marginBottom: "1px" }}><span style={{ color: "#999", marginRight: "6px", fontWeight: "400" }}>{l}:</span><span style={{ fontWeight: "600" }}>{v}</span></div>
            ))}
          </div>
        ) : <div />}
        <div style={{ minWidth: "210px" }}>
          {[[`Subtotal`, fmtMoney(subtotal)], ...(discAmt > 0 ? [[`Discount (${q.overallDiscountPct}%)`, `- ${fmtMoney(discAmt)}`], [`After Discount`, fmtMoney(afterDisc)]] : []), ...(sstAmt > 0 ? [[`SST (${q.sstPct}%)`, fmtMoney(sstAmt)]] : [])].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: "16px", fontSize: "11px", color: "#666", marginBottom: "3px", paddingRight: "4px" }}>
              <span>{l}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
            </div>
          ))}
          <div style={{ marginTop: "8px", background: "#111", padding: "11px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "20px", borderLeft: `5px solid ${primary}` }}>
            <span style={{ color: "white", fontWeight: "700", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Grand Total</span>
            <span style={{ color: "white", fontWeight: "800", fontSize: "15px", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(grand)}</span>
          </div>
        </div>
      </div>

      {q.notes && (
        <div style={{ margin: "0 20px 14px", padding: "10px 14px", background: `${primary}08`, borderLeft: `3px solid ${primary}`, fontSize: "11px", color: "#333" }}>
          <div style={{ fontSize: "9px", fontWeight: "800", color: primary, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "3px" }}>Notes</div>
          {q.notes}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 20px 16px", borderTop: "2px solid #111", fontSize: "10px", color: "#aaa" }}>
        <span>⚡ <span style={{ color: "#444", fontWeight: "600" }}>Computer generated document.</span> No signature required.</span>
        <span style={{ fontFamily: "monospace" }}>{q.quotationNo} · {new Date().toLocaleDateString("en-MY")}</span>
      </div>
    </div>
  );
}

// ── Template: Affirma (Clean Stamp) ──────────────────────────────────────
// White background throughout. Company info left, navy stamp box top-right.
// Minimal dividers, ultra-clean items table.
function TemplateAffirma({ entry }: { entry: GroupItem }) {
  const { quotation: q, items, orgName, orgLogoUrl, orgBrandColor,
    orgCompanyName, orgCompanyAddress, orgTaxNo, orgPhone, orgBankingInfo } = entry;
  const cust = q.customerSnapshot as any;
  const navy = orgBrandColor ?? "#142e5c";
  
  const showTP = !!Number(q.showTotalPrice);
  const subtotal = Number(q.subtotal ?? 0);
  const discAmt = Number(q.overallDiscountAmt ?? 0);
  const sstAmt = Number(q.sst ?? 0);
  const grand = Number(q.grandTotal ?? 0);
  const afterDisc = subtotal - discAmt;
  const bank = (orgBankingInfo as any[]).find(b => b.isPrimary) ?? (orgBankingInfo as any[])[0] ?? null;

  return (
    <div style={{ background: "white", width: "100%", fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: "12px", color: "#1a1a1a" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "24px 28px 16px" }}>

        {/* Left — logo + company */}
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", flex: 1 }}>
          {orgLogoUrl
            ? <img src={orgLogoUrl} alt="" style={{ height: "48px", width: "auto", objectFit: "contain", flexShrink: 0 }} />
            : <div style={{ width: "48px", height: "48px", background: navy, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: "800", fontSize: "16px", flexShrink: 0 }}>
                {(orgCompanyName ?? orgName).slice(0, 2).toUpperCase()}
              </div>
          }
          <div style={{ paddingTop: "2px" }}>
            <div style={{ fontWeight: "700", fontSize: "14px", color: navy, letterSpacing: "-0.2px" }}>{orgCompanyName ?? orgName}</div>
            {orgCompanyAddress && <div style={{ color: "#555", fontSize: "10.5px", marginTop: "3px", maxWidth: "300px", lineHeight: "1.5" }}>{orgCompanyAddress}</div>}
            <div style={{ color: "#888", fontSize: "10px", marginTop: "3px" }}>
              {[orgTaxNo && `Tax Reg: ${orgTaxNo}`, orgPhone].filter(Boolean).join("  ·  ")}
            </div>
          </div>
        </div>

        {/* Right — stamp box */}
        <div style={{ border: `2px solid ${navy}`, borderRadius: "4px", padding: "12px 16px", textAlign: "right", minWidth: "160px", flexShrink: 0 }}>
          <div style={{ fontSize: "9px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "2px", color: navy, marginBottom: "6px" }}>Quotation</div>
          <div style={{ fontFamily: "monospace", fontWeight: "700", fontSize: "15px", color: navy, letterSpacing: "0.5px" }}>{q.quotationNo}</div>
          <div style={{ width: "100%", height: "1px", background: `${navy}30`, margin: "8px 0" }} />
          <div style={{ fontSize: "10px", color: "#555" }}>
            <div>{fmtDate(q.createdAt)}</div>
            <div style={{ color: "#888", marginTop: "1px" }}>Valid: {fmtDate(q.validUntil)}</div>
          </div>
        </div>
      </div>

      {/* ── Divider ── */}
      <div style={{ height: "1px", background: `${navy}20`, margin: "0 28px" }} />

      {/* ── Info row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0", margin: "0 28px", padding: "14px 0" }}>
        {/* Customer */}
        <div>
          <div style={{ fontSize: "8.5px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1.2px", color: navy, marginBottom: "6px" }}>Attention To</div>
          {cust ? (
            <div style={{ lineHeight: "1.65" }}>
              <div style={{ fontWeight: "700", fontSize: "13px" }}>{[cust.title, cust.name].filter(Boolean).join(" ")}</div>
              {cust.position && <div style={{ color: "#444", fontSize: "11px" }}>{cust.position}{cust.department ? `, ${cust.department}` : ""}</div>}
              {cust.organizationName && <div style={{ color: "#444", fontSize: "11px" }}>{cust.organizationName}</div>}
              {cust.organizationAddress && <div style={{ color: "#777", fontSize: "10.5px" }}>{cust.organizationAddress}</div>}
              {(cust.email || cust.contactNo) && <div style={{ color: "#888", fontSize: "10.5px" }}>{[cust.email, cust.contactNo].filter(Boolean).join("  ·  ")}</div>}
            </div>
          ) : <div style={{ color: "#aaa" }}>—</div>}
        </div>

        {/* Meta */}
        <div style={{ background: "#f8f9fc", border: `1px solid ${navy}15`, borderRadius: "4px", padding: "10px 16px", fontSize: "10.5px", minWidth: "180px" }}>
          {([
            ["Sales Person", q.salesPersonName ?? "—"],
            ["Prepared By", q.preparedByName ?? "—"],
            ...(q.title && q.title !== "Loose Items" ? [["Subject", q.title]] : []),
          ] as [string, string][]).map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: "16px", marginBottom: "3px" }}>
              <span style={{ color: "#888", whiteSpace: "nowrap" }}>{l}</span>
              <span style={{ fontWeight: "500", color: "#333", textAlign: "right" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Divider ── */}
      <div style={{ height: "1px", background: `${navy}20`, margin: "0 28px 0" }} />

      {/* ── Items table ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${navy}` }}>
            {["#", "Code", "Description / MDA", "Qty", "UOM", "Unit Price", "Disc%", ...(showTP ? ["Total"] : [])].map(h => (
              <th key={h} style={{ padding: "8px 10px", color: navy, fontWeight: "700", textAlign: ["Unit Price","Total"].includes(h) ? "right" : h === "#" ? "center" : "left", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.8px", background: "white" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id} style={{ background: i % 2 === 0 ? "white" : "#fafbfc", borderBottom: `1px solid #f0f0f0` }}>
              <td style={{ padding: "7px 10px", color: "#bbb", textAlign: "center", fontSize: "10px" }}>{item.rowNo}</td>
              <td style={{ padding: "7px 10px", fontFamily: "monospace", fontSize: "10px", color: "#666" }}>{item.productCode ?? "—"}</td>
              <td style={{ padding: "7px 10px" }}>
                <div style={{ fontWeight: "500", color: "#1a1a1a" }}>{item.description ?? "—"}</div>
                {item.hasCert && item.mdaRegNo && <div style={{ fontSize: "9.5px", color: "#166534", marginTop: "1px" }}>MDA: {item.mdaRegNo}{item.mdaValidity ? ` · Exp: ${fmtDate(item.mdaValidity, true)}` : ""}</div>}
                {!item.hasCert && <div style={{ fontSize: "9.5px", color: "#92400e", marginTop: "1px" }}>No MDA certificate</div>}
              </td>
              <td style={{ padding: "7px 10px", textAlign: "center" }}>{item.qty}</td>
              <td style={{ padding: "7px 10px", textAlign: "center", color: "#888" }}>{item.uom || "—"}</td>
              <td style={{ padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>RM {Number(item.unitPrice ?? 0).toFixed(2)}</td>
              <td style={{ padding: "7px 10px", textAlign: "center", color: "#888" }}>{Number(item.discountPct ?? 0) > 0 ? `${item.discountPct}%` : "—"}</td>
              {showTP && <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: "600", fontVariantNumeric: "tabular-nums" }}>RM {Number(item.totalPrice ?? 0).toFixed(2)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Totals + bank ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "16px 28px", borderTop: `1px solid #eee` }}>
        {bank ? (
          <div style={{ fontSize: "11px" }}>
            <div style={{ fontSize: "8.5px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "1.2px", color: navy, marginBottom: "6px" }}>Payment To</div>
            {[["Bank", bank.bankName], ["Account Name", bank.accountHolder], ["Account No.", bank.accountNo]].map(([l, v]) => (
              <div key={l} style={{ marginBottom: "2px", color: "#444" }}>
                <span style={{ color: "#999", marginRight: "6px", fontSize: "10.5px" }}>{l}:</span>
                <span style={{ fontWeight: "500" }}>{v}</span>
              </div>
            ))}
          </div>
        ) : <div />}

        {/* Totals */}
        <div style={{ minWidth: "220px" }}>
          {[
            ["Subtotal", fmtMoney(subtotal)],
            ...(discAmt > 0 ? [
              [`Discount (${q.overallDiscountPct}%)`, `- ${fmtMoney(discAmt)}`],
              ["After Discount", fmtMoney(afterDisc)],
            ] : []),
            ...(sstAmt > 0 ? [[`SST (${q.sstPct}%)`, fmtMoney(sstAmt)]] : []),
          ].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#666", marginBottom: "3px", gap: "16px" }}>
              <span>{l}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
            </div>
          ))}
          <div style={{ marginTop: "8px", borderTop: `2px solid ${navy}`, paddingTop: "8px", display: "flex", justifyContent: "space-between", gap: "16px" }}>
            <span style={{ fontWeight: "700", fontSize: "13px", color: navy }}>Grand Total</span>
            <span style={{ fontWeight: "800", fontSize: "15px", color: navy, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(grand)}</span>
          </div>
        </div>
      </div>

      {q.notes && (
        <div style={{ margin: "0 28px 14px", padding: "10px 14px", background: "#f8f9fc", border: `1px solid ${navy}15`, borderRadius: "4px", fontSize: "11px", color: "#444" }}>
          <div style={{ fontSize: "8.5px", fontWeight: "700", color: navy, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>Notes</div>
          {q.notes}
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 28px 18px", borderTop: `1px solid #ebebeb`, fontSize: "10px", color: "#aaa" }}>
        <span><span style={{ color: "#555", fontWeight: "500" }}>Computer generated document.</span> No signature required.</span>
        <span style={{ fontFamily: "monospace" }}>{q.quotationNo} · {new Date().toLocaleDateString("en-MY")}</span>
      </div>
    </div>
  );
}

// ── Router — driven by pdfTemplate so preview matches the downloaded PDF ──
function QuotationPage({ entry }: { entry: GroupItem }) {
  const t = entry.orgPdfTemplate ?? "affirma";
  if (t === "nexus")  return <TemplateModern  entry={entry} />;
  if (t === "slate")  return <TemplateBold    entry={entry} />;
  if (t === "aura")   return <TemplateAffirma entry={entry} />;
  if (t === "zinc")   return <TemplateModern  entry={entry} />;
  return <TemplateAffirma entry={entry} />;
}

// ── Root client component ──────────────────────────────────────────────────
export function PrintClient({ group }: Props) {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);

  const first = group[0];

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #e5e7eb; font-family: 'Segoe UI', Arial, sans-serif; }
        .no-print { display: flex; }
        .print-page { margin: 0; background: white; }
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          .print-page { page-break-before: always; }
          .print-page:first-of-type { page-break-before: avoid; }
          @page { margin: 1cm; size: A4; }
        }
      `}</style>

      {/* Toolbar */}
      <div className="no-print" style={{ padding: "10px 20px", background: "white", borderBottom: "1px solid #e5e7eb", gap: "8px", alignItems: "center", position: "sticky", top: 0, zIndex: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <button onClick={() => window.close()} style={{ fontSize: "13px", padding: "6px 14px", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", background: "white" }}>
          ← Close
        </button>
        <button onClick={() => window.print()} style={{ fontSize: "13px", padding: "6px 16px", border: "none", borderRadius: "6px", cursor: "pointer", background: "#111", color: "white", fontWeight: "600" }}>
          Print / Save as PDF
        </button>
        <span style={{ fontSize: "12px", color: "#6b7280", marginLeft: "4px" }}>
          {group.length > 1 ? `${group.length} quotations · all pages included` : first.quotation.quotationNo}
        </span>
      </div>

      {/* One print page per quotation */}
      {group.map((entry, i) => (
        <div key={entry.quotation.id} className="print-page" style={{ maxWidth: "820px", margin: i === 0 ? "24px auto 0" : "16px auto 0", boxShadow: "0 2px 12px rgba(0,0,0,0.10)" }}>
          <QuotationPage entry={entry} />
        </div>
      ))}
      <div style={{ height: "40px" }} className="no-print" />
    </>
  );
}
