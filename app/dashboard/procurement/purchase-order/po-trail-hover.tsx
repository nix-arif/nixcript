"use client";

import {
  BoxesIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  FileTextIcon,
  InboxIcon,
  Link2Icon,
  PackageIcon,
  PencilIcon,
  ShoppingCartIcon,
  XCircleIcon,
  FilePenLineIcon,
} from "lucide-react";
import { getPurchaseOrderHistory, getPurchaseOrderHistoryCentralized, type PurchaseOrderHistory } from "@/server/purchase-order";
import { amendmentEvents } from "@/components/amendment-history";
import { HistoryHover, historyWord as word, type HistoryEvent } from "@/components/history-hover";

const amount = (v: string, currency: string) =>
  `${currency === "MYR" ? "RM" : currency} ${Number(v || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;


// its amendments (Rev 1, Rev 2…) as amber events
const amended = (evs: Awaited<ReturnType<typeof amendmentEvents>>): HistoryEvent[] =>
  evs.map((e) => ({ ...e, tone: "amber" as const, icon: <FilePenLineIcon className="w-3 h-3" /> }));
// A Supplier PO's fulfilment trail: what it was raised for, its approval, and the
// supplier's side of it (packing lists, goods received).
function buildPoHistory(h: PurchaseOrderHistory): HistoryEvent[] {
  const ev: HistoryEvent[] = [];
  const icon = "w-3 h-3";
  const { po } = h;

  for (const c of h.cpos)
    ev.push({ at: new Date(c.receivedDate ?? c.createdAt), title: `Customer PO ${c.customerPoNo}`, detail: "Received from customer", tone: "slate", icon: <InboxIcon className={icon} /> });
  if (h.so)
    ev.push({ at: new Date(h.so.createdAt), title: `Sales order ${h.so.soNo}`, detail: word(h.so.status), tone: "violet", icon: <ShoppingCartIcon className={icon} /> });
  if (h.pr)
    ev.push({ at: new Date(h.pr.createdAt), title: `Purchase requisition ${h.pr.prNo}`, detail: word(h.pr.status), tone: "slate", icon: <FileTextIcon className={icon} /> });
  ev.push({
    at: new Date(po.createdAt),
    title: `Supplier PO ${po.poNo ?? po.prNo ?? ""} created`.replace("  ", " "),
    detail: [po.supplierName, po.createdByName && `by ${po.createdByName}`, amount(po.grandTotal, po.currency)].filter(Boolean).join(" · "),
    tone: "blue",
    icon: <PackageIcon className={icon} />,
  });
  if (po.approvedAt)
    ev.push({ at: new Date(po.approvedAt), title: "Approved", detail: po.approvedByName ? `by ${po.approvedByName}` : undefined, tone: "green", icon: <CheckCircle2Icon className={icon} /> });
  for (const s of h.intercompanySos)
    ev.push({ at: new Date(s.createdAt), title: `Sales order ${s.soNo} at ${s.orgName ?? "sibling company"}`, detail: `${word(s.status)} · intercompany`, tone: "violet", icon: <Link2Icon className={icon} /> });
  for (const p of h.packingLists)
    ev.push({
      at: new Date(p.createdAt),
      title: `Packing list ${p.packingListNo}`,
      detail: [word(p.status), p.expectedDate && p.status === "pending" ? `expected ${new Date(p.expectedDate).toLocaleDateString("en-MY", { day: "2-digit", month: "short" })}` : null].filter(Boolean).join(" · "),
      tone: p.status === "cancelled" ? "red" : "amber",
      icon: <BoxesIcon className={icon} />,
    });
  for (const g of h.goodsReceipts)
    ev.push({ at: new Date(g.receivedDate), title: `Goods received ${g.grNo}`, detail: word(g.status), tone: g.status === "recalled" ? "red" : "green", icon: <ClipboardCheckIcon className={icon} /> });

  // the record keeps no per-change history: only its status now and when it last changed
  const edited = new Date(po.updatedAt).getTime() - new Date(po.createdAt).getTime() > 60_000;
  if (po.status === "cancelled")
    ev.push({ at: new Date(po.updatedAt), title: "Cancelled", tone: "red", icon: <XCircleIcon className={icon} /> });
  else if (po.status === "fulfilled")
    ev.push({ at: new Date(po.updatedAt), title: "Fulfilled", tone: "green", icon: <CheckCircle2Icon className={icon} /> });
  else if (po.status === "draft" && edited)
    ev.push({ at: new Date(po.updatedAt), title: "Last edited", tone: "slate", icon: <PencilIcon className={icon} /> });

  return ev;
}

// Hovering a Supplier PO card in the list shows its trail (components/history-hover.tsx).
// centralized: the card is from the centralized list (any of the owner's companies).
export function PoTrailHover({ id, poNo, centralized = false, children }: { id: string; poNo: string; centralized?: boolean; children: React.ReactElement }) {
  const load = centralized ? getPurchaseOrderHistoryCentralized : getPurchaseOrderHistory;
  return (
    <HistoryHover label={poNo} load={async () => {
      const [h, revs] = await Promise.all([load(id), amendmentEvents("po", id)]);
      return h ? [...buildPoHistory(h), ...amended(revs)] : null;
    }}>
      {children}
    </HistoryHover>
  );
}
