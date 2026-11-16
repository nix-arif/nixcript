"use client";

import { useRef, useState } from "react";
import { PencilIcon, Undo2Icon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Source = "quote" | "catalog" | "user" | "cpo" | "so";

export type DescriptionItem = {
  _key: string;
  description?: string;
  productCode?: string;
  designBrandCode?: string | null;
  sourcingType?: "trading" | "oem" | null;
  _dbDescription?: string | null;
  _dbRef?: string;
  _descriptionSource?: Source[] | null;
};

const same = (a?: string | null, b?: string | null) => (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();

// The description of a sales order item. When the product database has one, the field shows it locked:
// the pencil asks for confirmation before it can be changed, and once it differs there is a button to
// revert to the database text. Items with no database description stay freely editable.
export function DescriptionField({
  item, onUpdate, currentUserName, dataRow, dataCol, onKeyDown,
}: {
  item: DescriptionItem;
  onUpdate: (key: string, patch: Record<string, unknown>) => void;
  currentUserName?: string;
  dataRow?: number;
  dataCol?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const db = item._dbDescription || null;
  const [unlocked, setUnlocked] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const customised = !!db && !same(item.description, db);
  const locked = !!db && !unlocked && !customised;

  function change(value: string) {
    const v = value.toUpperCase();
    const others = (item._descriptionSource ?? []).filter((s) => s !== "quote" && s !== "catalog");
    onUpdate(item._key, {
      description: v,
      // typing it back to the database text counts as the database description again
      _descriptionSource: db && same(v, db) ? ["catalog"] : [...new Set([...others, "so"])],
      _soEditedBy: currentUserName || "user",
    });
  }

  function revert() {
    if (!db) return;
    onUpdate(item._key, { description: db, _descriptionSource: ["catalog"] });
    setUnlocked(false);
  }

  const ref = item._dbRef || item.productCode || "";

  return (
    <div>
      <div className="flex items-center gap-1">
        <Input
          ref={input}
          data-row={dataRow}
          data-col={dataCol}
          value={item.description ?? ""}
          readOnly={locked}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          className={`h-7 text-[11px] md:text-[11px] ${locked ? "bg-muted/40 cursor-default" : ""}`}
          title={locked ? `Description from the product database (${ref}). Click the pencil to change it for this order.` : undefined}
        />
        {locked && (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Change the description" onClick={() => setConfirm(true)}>
            <PencilIcon className="w-3 h-3" />
          </Button>
        )}
        {customised && (
          <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 gap-1 px-2 text-[10px]" title="Put the product database description back" onClick={revert}>
            <Undo2Icon className="w-3 h-3" /> Revert
          </Button>
        )}
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change this description?</DialogTitle>
            <DialogDescription>
              This description comes from the product database ({ref}). Changing it only affects this sales order, and you can
              revert it to the database text at any time.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground whitespace-pre-line">{db}</div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Keep database description</Button>
            <Button
              onClick={() => {
                setConfirm(false);
                setUnlocked(true);
                setTimeout(() => input.current?.focus(), 0);
              }}
            >
              Change it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
