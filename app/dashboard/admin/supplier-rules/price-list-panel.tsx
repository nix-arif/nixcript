"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { saveIntercompanyPrices, deleteIntercompanyPrice } from "@/server/intercompany-pricing";
import { downloadPriceListTemplate, readPriceListSheet } from "@/lib/intercompany/price-list-sheet";
import type { PricingData } from "./supplier-rules-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DownloadIcon, PlusIcon, SearchIcon, TagsIcon, TrashIcon, UploadIcon } from "lucide-react";

export function PriceListPanel({ data, reload }: { data: PricingData; reload: () => Promise<void> }) {
  const { orgs, prices } = data;
  const [seller, setSeller] = useState(orgs[0]?.id ?? "");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<"down" | "up" | "paste" | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const nameOf = (id: string) => orgs.find((o) => o.id === id)?.name ?? "—";
  const mine = prices.filter((p) => p.sellerOrganizationId === seller);
  const shown = mine.filter((p) => !filter.trim() || p.productCode.toLowerCase().includes(filter.trim().toLowerCase()));

  const report = (saved: number, skipped: string[], extra = "") => {
    const head = `${saved} price${saved === 1 ? "" : "s"} saved for ${nameOf(seller)}${extra}`;
    if (skipped.length > 0) toast.warning(`${head}. ${skipped.length} skipped: ${skipped.slice(0, 4).join("; ")}${skipped.length > 4 ? "…" : ""}`, { duration: 15000 });
    else toast.success(head);
  };

  async function download() {
    setBusy("down");
    try { await downloadPriceListTemplate(seller, `Intercompany-price-list-${nameOf(seller).replace(/[^\w.-]+/g, "_")}.xlsx`); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }

  async function upload(file: File) {
    setBusy("up");
    try {
      const { entries, blank } = await readPriceListSheet(file);
      if (entries.length === 0) return toast.error(`No prices found in the sheet${blank > 0 ? ` (${blank} products have no price yet)` : ""}. Fill in the Unit price column and upload again.`);
      const r = await saveIntercompanyPrices(seller, entries);
      await reload();
      report(r.saved, r.skipped, blank > 0 ? `, ${blank} left empty` : "");
    } catch (e: any) { toast.error(e.message); } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function savePaste() {
    // one product per line: code, then the price (tab, comma, semicolon or space); an optional currency can follow
    const entries = paste.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      let parts = l.split(/[\t;]+|\s+/).filter(Boolean);
      if (parts.length === 1 && l.includes(",")) parts = l.split(",").map((x) => x.trim()).filter(Boolean);
      return { productCode: (parts[0] ?? "").replace(/,$/, ""), unitPrice: parts[1] ?? "", currency: parts[2] };
    });
    if (entries.length === 0) return toast.error("Paste at least one line: product code, then price");
    setBusy("paste");
    try {
      const r = await saveIntercompanyPrices(seller, entries);
      await reload();
      report(r.saved, r.skipped);
      if (r.saved > 0) { setPaste(""); if (r.skipped.length === 0) setPasteOpen(false); }
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }

  async function remove(id: string) {
    try { await deleteIntercompanyPrice(id); await reload(); } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="space-y-4 pt-1">
      <p className="max-w-2xl text-sm text-muted-foreground">
        The price a seller charges its sibling organizations for a product. It is used when a PO&apos;s method is &ldquo;Intercompany price list&rdquo;.
      </p>

      {orgs.length > 1 && (
        <div className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
          {orgs.map((o) => (
            <button key={o.id} type="button" aria-pressed={seller === o.id} onClick={() => { setSeller(o.id); setFilter(""); }}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${seller === o.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {o.name}
              <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground">{prices.filter((p) => p.sellerOrganizationId === o.id).length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 w-56 pl-8" placeholder="Search product code" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null} onClick={download}><DownloadIcon className="h-3.5 w-3.5" />{busy === "down" ? "Preparing…" : "Download template"}</Button>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => fileRef.current?.click()}><UploadIcon className="h-3.5 w-3.5" />{busy === "up" ? "Uploading…" : "Upload filled sheet"}</Button>
          <Button size="sm" className="gap-1.5" onClick={() => setPasteOpen(true)}><PlusIcon className="h-3.5 w-3.5" />Add prices</Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        </div>
      </div>

      {mine.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center">
          <TagsIcon className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <div className="mb-1 text-sm font-medium">No prices for {nameOf(seller)} yet</div>
          <p className="mx-auto mb-4 max-w-md text-xs text-muted-foreground">
            Download the template, which lists every product of {nameOf(seller)}, fill in the Unit price column and upload it. Or paste codes and prices with Add prices.
          </p>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null} onClick={download}><DownloadIcon className="h-3.5 w-3.5" />Download template</Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No product matches &ldquo;{filter}&rdquo;.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-xs text-muted-foreground backdrop-blur">
                <tr><th className="px-4 py-2 text-left font-medium">Product code</th><th className="px-4 py-2 text-right font-medium">Price</th><th className="w-10" /></tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className="border-t border-border/60 hover:bg-muted/20">
                    <td className="px-4 py-1.5 font-mono text-xs">{p.productCode}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{p.currency} {Number(p.unitPrice).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                    <td className="px-1 py-1.5 text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove(p.id)} aria-label={`Remove price for ${p.productCode}`}><TrashIcon className="h-3.5 w-3.5" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground">{shown.length} of {mine.length} products</div>
        </div>
      )}

      <Sheet open={pasteOpen} onOpenChange={setPasteOpen}>
        <SheetContent className="w-full max-w-lg! overflow-y-auto px-8 sm:max-w-md">
          <SheetHeader className="mb-5">
            <SheetTitle>Add prices for {nameOf(seller)}</SheetTitle>
            <SheetDescription>One product per line: the code, then the price.</SheetDescription>
          </SheetHeader>
          <div className="space-y-3">
            <Textarea rows={10} value={paste} onChange={(e) => setPaste(e.target.value)} className="font-mono text-xs" autoFocus placeholder={"M235-160N\t85.50\nM611-64NP, 120\nF680-18DP 42.00 MYR"} />
            <p className="text-[11px] text-muted-foreground">You can paste two columns straight from a spreadsheet. A product already on the list gets the new price. Currency is MYR unless you add one as a third column.</p>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1" onClick={savePaste} disabled={busy === "paste"}>{busy === "paste" ? "Saving…" : "Save prices"}</Button>
              <Button variant="outline" onClick={() => setPasteOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
