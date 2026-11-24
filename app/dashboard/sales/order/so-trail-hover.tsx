"use client";

import {
  CheckCircle2Icon,
  FileTextIcon,
  InboxIcon,
  Link2Icon,
  PackageIcon,
  ReceiptIcon,
  SendIcon,
  ShoppingCartIcon,
  TruckIcon,
  WalletIcon,
  XCircleIcon,
} from "lucide-react";
import { getSalesOrderHistory, getSalesOrderHistoryCentralized, type SalesOrderHistory } from "@/server/sales-order";
import { HistoryHover, historyWord as word, historyMoney as money, type HistoryEvent } from "@/components/history-hover";

// The same kind of short, factual history as a Customer PO's hover card, from
// the SO's side: where it came from, its approval, and everything raised from it.
function buildSoHistory(h: SalesOrderHistory): HistoryEvent[] {
  const ev: HistoryEvent[] = [];
  const icon = "w-3 h-3";
  const { so } = h;

  if (h.source)
    ev.push({ at: new Date(so.createdAt), title: `From ${h.source.orgName ?? "a sibling company"}'s PO ${h.source.poNo ?? ""}`.trim(), detail: "Created automatically (intercompany)", tone: "violet", icon: <Link2Icon className={icon} /> });
  for (const c of h.cpos)
    ev.push({ at: new Date(c.receivedDate ?? c.createdAt), title: `Customer PO ${c.customerPoNo}`, detail: "Received from customer", tone: "slate", icon: <InboxIcon className={icon} /> });
  ev.push({
    at: new Date(so.createdAt),
    title: `Sales order ${so.soNo} created`,
    detail: [so.createdByName && `by ${so.createdByName}`, so.grandTotal && money(so.grandTotal)].filter(Boolean).join(" · ") || undefined,
    tone: "blue",
    icon: <ShoppingCartIcon className={icon} />,
  });
  if (so.submittedAt)
    ev.push({ at: new Date(so.submittedAt), title: "Submitted for approval", detail: so.submittedByName ? `by ${so.submittedByName}` : undefined, tone: "slate", icon: <SendIcon className={icon} /> });
  if (so.approvedAt)
    ev.push({
      at: new Date(so.approvedAt),
      title: "Approved",
      detail: [so.approvedByName && `by ${so.approvedByName}`, so.stockReservationStatus === "reserved" ? "stock reserved" : so.stockReservationStatus === "insufficient" ? "stock short" : null].filter(Boolean).join(" · ") || undefined,
      tone: "green",
      icon: <CheckCircle2Icon className={icon} />,
    });
  for (const r of h.prs)
    ev.push({ at: new Date(r.createdAt), title: `Purchase requisition ${r.prNo}`, detail: word(r.status), tone: r.status === "cancelled" ? "red" : "slate", icon: <FileTextIcon className={icon} /> });
  for (const p of h.pos)
    ev.push({ at: new Date(p.createdAt), title: `Supplier PO ${p.poNo ?? p.prNo ?? ""}`.trim(), detail: [word(p.status), p.supplierName].filter(Boolean).join(" · "), tone: p.status === "cancelled" ? "red" : "amber", icon: <PackageIcon className={icon} /> });
  for (const d of h.dos)
    ev.push({ at: new Date(d.createdAt), title: `Delivery order ${d.doNo}`, detail: word(d.status), tone: "amber", icon: <TruckIcon className={icon} /> });
  for (const i of h.invoices) {
    ev.push({ at: new Date(i.createdAt), title: `Invoice ${i.invoiceNo}`, detail: `${word(i.status)} · ${money(i.grandTotal)}`, tone: i.status === "cancelled" ? "red" : "violet", icon: <ReceiptIcon className={icon} /> });
    if (i.paidAt)
      ev.push({ at: new Date(i.paidAt), title: `Payment received for ${i.invoiceNo}`, detail: money(i.paidAmount ?? i.grandTotal), tone: "green", icon: <WalletIcon className={icon} /> });
  }
  // the record keeps no cancel timestamp of its own: its last change is the closest
  if (so.status === "cancelled")
    ev.push({ at: new Date(so.updatedAt ?? so.createdAt), title: "Cancelled", tone: "red", icon: <XCircleIcon className={icon} /> });
  else if (so.status === "fulfilled")
    ev.push({ at: new Date(so.updatedAt ?? so.createdAt), title: "Fulfilled", tone: "green", icon: <CheckCircle2Icon className={icon} /> });

  return ev;
}

// Hovering a Sales Order row in the list shows its history (components/history-hover.tsx).
// centralized: the row is from the centralized list (any of the owner's companies).
export function SoTrailHover({ id, soNo, centralized = false, children }: { id: string; soNo: string; centralized?: boolean; children: React.ReactElement }) {
  const load = centralized ? getSalesOrderHistoryCentralized : getSalesOrderHistory;
  return (
    <HistoryHover label={soNo} load={() => load(id).then((h) => (h ? buildSoHistory(h) : null))}>
      {children}
    </HistoryHover>
  );
}
