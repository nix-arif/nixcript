"use client";

import {
  CheckCircle2Icon,
  FileTextIcon,
  InboxIcon,
  PackageIcon,
  PencilIcon,
  ReceiptIcon,
  ShoppingCartIcon,
  TruckIcon,
  WalletIcon,
  XCircleIcon,
} from "lucide-react";
import { getCustomerPoForTracking, type CustomerPoTrackingData } from "@/server/customer-purchase-order";
import { HistoryHover, historyWord as word, historyMoney as money, type HistoryEvent } from "@/components/history-hover";

// A short, factual history built from what the system already records
function buildTrail(t: CustomerPoTrackingData): HistoryEvent[] {
  const ev: HistoryEvent[] = [];
  const icon = "w-3 h-3";
  const { cpo } = t;

  if (cpo.receivedDate)
    ev.push({ at: new Date(cpo.receivedDate), title: "PO received from customer", tone: "slate", icon: <InboxIcon className={icon} /> });
  ev.push({
    at: new Date(cpo.createdAt),
    title: "Recorded in the system",
    detail: t.createdByName ? `by ${t.createdByName}` : undefined,
    tone: "blue",
    icon: <FileTextIcon className={icon} />,
  });
  if (t.so)
    ev.push({ at: new Date(t.so.createdAt), title: `Sales order ${t.so.soNo}`, detail: `${word(t.so.status)}${t.so.grandTotal ? ` · ${money(t.so.grandTotal)}` : ""}`, tone: "violet", icon: <ShoppingCartIcon className={icon} /> });
  for (const r of t.requisitions)
    ev.push({ at: new Date(r.createdAt), title: `Purchase requisition ${r.prNo}`, detail: word(r.status), tone: r.status === "cancelled" ? "red" : "slate", icon: <FileTextIcon className={icon} /> });
  for (const p of t.internalPos)
    ev.push({ at: new Date(p.createdAt), title: `Supplier PO ${p.poNo ?? p.prNo ?? ""}`.trim(), detail: word(p.status), tone: "amber", icon: <PackageIcon className={icon} /> });
  for (const d of t.dos)
    ev.push({ at: new Date(d.createdAt), title: `Delivery order ${d.doNo}`, detail: word(d.status), tone: "amber", icon: <TruckIcon className={icon} /> });
  for (const i of t.invoices) {
    ev.push({ at: new Date(i.createdAt), title: `Invoice ${i.invoiceNo}`, detail: `${word(i.status)} · ${money(i.grandTotal)}`, tone: "violet", icon: <ReceiptIcon className={icon} /> });
    if (i.paidAt)
      ev.push({ at: new Date(i.paidAt), title: `Payment received for ${i.invoiceNo}`, detail: money(i.paidAmount ?? i.grandTotal), tone: "green", icon: <WalletIcon className={icon} /> });
  }

  // The record keeps no per-edit history: only that it changed after it was created, and its status now
  const edited = new Date(cpo.updatedAt).getTime() - new Date(cpo.createdAt).getTime() > 60_000;
  if (cpo.status === "fulfilled")
    ev.push({ at: new Date(cpo.updatedAt), title: "Marked fulfilled", tone: "green", icon: <CheckCircle2Icon className={icon} /> });
  else if (cpo.status === "cancelled")
    ev.push({ at: new Date(cpo.updatedAt), title: "Cancelled", tone: "red", icon: <XCircleIcon className={icon} /> });
  else if (edited)
    ev.push({ at: new Date(cpo.updatedAt), title: "Last edited", tone: "slate", icon: <PencilIcon className={icon} /> });

  return ev;
}


// Hovering a Customer PO row in the list shows its history (components/history-hover.tsx).
export function CpoTrailHover({
  id, poNo, children,
}: { id: string; poNo: string; children: React.ReactElement }) {
  return (
    <HistoryHover label={poNo} load={() => getCustomerPoForTracking(id).then((d) => (d ? buildTrail(d) : null))}>
      {children}
    </HistoryHover>
  );
}
