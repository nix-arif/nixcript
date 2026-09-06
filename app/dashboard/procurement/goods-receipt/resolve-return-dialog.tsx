"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getPackingListsForSupplier, type ReturnResolutionInput } from "@/server/packing-list";
import { cn } from "@/lib/utils";

const RESOLUTION_TYPES: { value: ReturnResolutionInput["type"]; label: string; description: string }[] = [
  { value: "replacement", label: "Replacement received", description: "Supplier sent a new shipment to make up for this" },
  { value: "credited", label: "Credited by supplier", description: "Supplier issued a credit instead of replacing it" },
  { value: "written_off", label: "Written off", description: "No replacement expected — closing this out" },
  { value: "other", label: "Other", description: "Settled some other way — explain in notes" },
];

interface Props {
  supplierId: string | null;
  // The org the return item actually belongs to — only needed when this
  // dialog is opened from a cross-org view (the centralized Outstanding
  // Issues panel), where it can differ from the caller's own active org.
  targetOrgId?: string;
  itemLabel: string;
  qty: number;
  uom?: string | null;
  submitting: boolean;
  onConfirm: (resolution: ReturnResolutionInput) => void;
  onClose: () => void;
}

// The one dialog for resolving a "return to supplier" line — shared by the
// GR detail page and both Outstanding Issues banners (own-org and
// centralized) rather than tripled, since matching a return to whatever
// actually settled it is the same decision no matter where you make it.
//
// The caller mounts this only while a specific item is being resolved
// (conditional render, keyed by that item's id) rather than passing an
// `open` boolean — a fresh mount per item is what gives each resolve
// attempt its own clean form state, with no reset-on-open effect needed.
export function ResolveReturnDialog({ supplierId, targetOrgId, itemLabel, qty, uom, submitting, onConfirm, onClose }: Props) {
  const [type, setType] = useState<ReturnResolutionInput["type"]>("replacement");
  const [packingLists, setPackingLists] = useState<{ id: string; packingListNo: string; status: string; createdAt: Date }[]>([]);
  const [loadingPls, setLoadingPls] = useState(!!supplierId);
  const [packingListId, setPackingListId] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!supplierId) return;
    getPackingListsForSupplier(supplierId, targetOrgId)
      .then(setPackingLists)
      .catch(() => toast.error("Couldn't load packing lists for this supplier"))
      .finally(() => setLoadingPls(false));
  }, [supplierId, targetOrgId]);

  function handleConfirm() {
    if (type === "replacement" && !packingListId) {
      toast.error("Select the packing list carrying the replacement");
      return;
    }
    onConfirm({ type, packingListId: type === "replacement" ? packingListId : undefined, notes: notes || undefined });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Resolve return</DialogTitle>
        <p className="text-xs text-muted-foreground -mt-2">
          {qty} {uom || ""} of {itemLabel} sent back to the supplier — how was this settled?
        </p>

        <div className="space-y-2">
          {RESOLUTION_TYPES.map((rt) => (
            <label
              key={rt.value}
              className={cn(
                "flex items-start gap-2 border rounded-lg px-3 py-2 cursor-pointer transition-colors",
                type === rt.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30",
              )}
            >
              <input
                type="radio"
                name="resolution-type"
                className="mt-0.5"
                checked={type === rt.value}
                onChange={() => setType(rt.value)}
              />
              <div>
                <div className="text-sm font-medium">{rt.label}</div>
                <div className="text-xs text-muted-foreground">{rt.description}</div>
              </div>
            </label>
          ))}
        </div>

        {type === "replacement" && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              Replacement packing list <span className="text-destructive">*</span>
            </label>
            {!supplierId ? (
              <p className="text-xs text-muted-foreground">No supplier on record for this item.</p>
            ) : loadingPls ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : packingLists.length === 0 ? (
              <p className="text-xs text-muted-foreground">No packing lists recorded yet for this supplier — create one first once the replacement has been logged.</p>
            ) : (
              <select
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={packingListId}
                onChange={(e) => setPackingListId(e.target.value)}
              >
                <option value="">— Select packing list —</option>
                {packingLists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.packingListNo} ({pl.status}) · {new Date(pl.createdAt).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium">
            Notes {type !== "replacement" && <span className="text-muted-foreground font-normal">(optional)</span>}
          </label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any extra detail…" className="text-sm resize-none" rows={2} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleConfirm} disabled={submitting}>
            {submitting ? "Saving…" : "Confirm"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
