"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { SalesOrderWithItems } from "@/server/sales-order";
import { createConsignment } from "@/server/consignment";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeftIcon, PackageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface LineItem {
  soItemId: string;
  productId: string | null;
  productCode: string | null;
  description: string;
  uom: string | null;
  unitPrice: string;
  soQty: string;
  qty: string;
  included: boolean;
}

interface Props {
  so: SalesOrderWithItems;
}

export function CreateConsignmentClient({ so }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const snap = so.customerSnapshot as any;

  const [sentDate, setSentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>(
    so.items.map((item) => ({
      soItemId: item.id,
      productId: item.productId ?? null,
      productCode: item.productCode ?? null,
      description: item.description ?? "",
      uom: item.uom ?? null,
      unitPrice: item.unitPrice ?? "0",
      soQty: item.qty ?? "0",
      qty: item.qty ?? "0",
      included: true,
    })),
  );

  function toggleLine(idx: number) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, included: !l.included } : l));
  }

  function setLineQty(idx: number, val: string) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, qty: val } : l));
  }

  function handleCreate() {
    const included = lines.filter((l) => l.included);
    if (included.length === 0) {
      toast.error("Include at least one item.");
      return;
    }
    for (const l of included) {
      const qty = parseFloat(l.qty);
      if (isNaN(qty) || qty <= 0) {
        toast.error(`Enter a valid qty for: ${l.description}`);
        return;
      }
    }

    startTransition(async () => {
      try {
        const con = await createConsignment({
          soId: so.id,
          soNo: so.soNo,
          customerId: so.customerId ?? undefined,
          sentDate: sentDate ? new Date(sentDate) : undefined,
          expiryDate: expiryDate ? new Date(expiryDate) : undefined,
          notes: notes || undefined,
          items: included.map((l) => ({
            productId: l.productId,
            productCode: l.productCode ?? undefined,
            description: l.description,
            uom: l.uom ?? undefined,
            unitPrice: l.unitPrice,
            qtySent: l.qty,
          })),
        });
        toast.success(`Consignment ${con.consignmentNo} created.`);
        router.push(`/dashboard/sales/consignment/${con.id}`);
      } catch (err: any) {
        toast.error(err.message ?? "Failed to create consignment.");
      }
    });
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <button
        onClick={() => router.push(`/dashboard/sales/order/${so.id}`)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to {so.soNo}
      </button>

      <PageHeader title="Create Consignment" description={`From Sales Order ${so.soNo}`} />

      {/* Customer */}
      {snap && (
        <div className="border rounded-lg p-4 text-sm space-y-0.5">
          <p className="font-medium">{[snap.title, snap.name].filter(Boolean).join(" ")}</p>
          {snap.organizationName && <p className="text-muted-foreground">{snap.organizationName}</p>}
        </div>
      )}

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Sent Date</label>
          <Input type="date" value={sentDate} onChange={(e) => setSentDate(e.target.value)} className="h-9 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Expiry Date (optional)</label>
          <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="h-9 text-sm" />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Notes (optional)</label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Trial use for 30 days" className="h-9 text-sm" />
      </div>

      {/* Items */}
      <div className="space-y-2">
        <p className="text-sm font-semibold flex items-center gap-2"><PackageIcon className="h-4 w-4" /> Items to Consign</p>
        <p className="text-xs text-muted-foreground">Uncheck items to exclude. Adjust qty if sending partial.</p>
        <div className="border rounded-lg divide-y">
          {lines.map((line, idx) => (
            <div
              key={line.soItemId}
              className={cn("flex items-center gap-3 px-3 py-2.5 text-sm", !line.included && "opacity-50")}
            >
              <input
                type="checkbox"
                checked={line.included}
                onChange={() => toggleLine(idx)}
                className="h-4 w-4 rounded border-border cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{line.description}</p>
                {line.productCode && <p className="text-xs text-muted-foreground">{line.productCode}</p>}
              </div>
              <span className="text-xs text-muted-foreground w-12 text-center">{line.uom ?? ""}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Qty:</span>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={line.qty}
                  onChange={(e) => setLineQty(idx, e.target.value)}
                  disabled={!line.included}
                  className="h-7 w-20 text-sm"
                />
              </div>
              <span className="text-xs text-muted-foreground w-20 text-right">
                {`RM ${Number(line.unitPrice).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push(`/dashboard/sales/order/${so.id}`)}>Cancel</Button>
        <Button onClick={handleCreate} disabled={isPending}>
          {isPending ? "Creating…" : "Create Consignment"}
        </Button>
      </div>
    </div>
  );
}
