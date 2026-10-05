"use client";

// Consigned IN — stock a sister company placed with this company. Quantity
// only, no value: it's still the owner's stock (server/consign.ts
// getConsignedInStock). The agent may move it between its own warehouse and
// specialists (moveConsignedStock); using, returning or counting it goes
// through the consignment.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeftIcon, HandshakeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { moveConsignedStock, type ConsignedInRow } from "@/server/consign";
import { isLendable, unitUseLabel } from "@/lib/inventory/constants";
import { cn } from "@/lib/utils";

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : null);

export interface MoveTarget { label: string; name: string }

interface Group { key: string; ownerOrgId: string; owner: string; label: string; location: string; rows: ConsignedInRow[] }

export function ConsignedInStock({ rows, title = "Consigned in — owned by others", moveTargets, canMove = false }: {
  rows: ConsignedInRow[]; title?: string; moveTargets?: MoveTarget[]; canMove?: boolean;
}) {
  const [moving, setMoving] = useState<Group | null>(null);
  if (!rows.length) return null;
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const k = `${r.ownerOrgId}|${r.label}`;
    const g = groups.get(k) ?? { key: k, ownerOrgId: r.ownerOrgId, owner: r.ownerName, label: r.label, location: r.locationName, rows: [] };
    g.rows.push(r);
    groups.set(k, g);
  }
  const sorted = [...groups.values()].sort((a, b) => a.owner.localeCompare(b.owner) || a.location.localeCompare(b.location));
  const movable = canMove && (moveTargets?.length ?? 0) > 1;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-1.5"><HandshakeIcon className="h-4 w-4 text-muted-foreground" />{title}</h2>
          <p className="text-xs text-muted-foreground">
            Physically here but still the owner&apos;s stock — not part of your stock or its value. Move it between your warehouse and specialists here; use, return or count it through the consignment.
          </p>
        </div>
        <Link href="/dashboard/consignment" className="text-xs font-medium text-primary hover:underline">Open consignments →</Link>
      </div>
      {sorted.map((g) => (
        <div key={g.key} className="rounded-lg border border-dashed border-border overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{g.location}</span>
            <span className="text-[11px] rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 font-medium text-violet-700 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-300">Owner: {g.owner}</span>
            <span className="text-xs text-muted-foreground ml-auto">{g.rows.length} product{g.rows.length !== 1 ? "s" : ""}</span>
            {movable && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setMoving(g)}>
                <ArrowRightLeftIcon className="h-3.5 w-3.5" />Move
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/10 text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium w-36">Product Code</th>
                  <th className="px-4 py-2 text-left font-medium">Description · lots / serials</th>
                  <th className="px-4 py-2 text-center font-medium w-16">UOM</th>
                  <th className="px-4 py-2 text-right font-medium w-28">Qty held</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {g.rows.map((r) => (
                  <tr key={r.key} className="align-top">
                    <td className="px-4 py-2 font-mono text-xs font-medium whitespace-nowrap">{r.productCode}</td>
                    <td className="px-4 py-2">
                      <div className="text-sm">{r.description}</div>
                      {(r.lots.length > 0 || r.units.length > 0) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.lots.map((l) => (
                            <span key={l.lotNo} className="text-[11px] rounded border border-border bg-background px-1.5 py-0.5">
                              Lot {l.lotNo} · {fmtQty(l.qty)}{fmtDate(l.expiryDate) ? ` · exp ${fmtDate(l.expiryDate)}` : ""}
                            </span>
                          ))}
                          {r.units.map((u) => (
                            <span key={u.id} className={cn("text-[11px] rounded border px-1.5 py-0.5",
                              isLendable(u.intendedUse) ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300" : "border-border bg-background")}>
                              SN {u.serialNo} · {unitUseLabel(u.intendedUse).toLowerCase()}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center text-xs text-muted-foreground">{r.uom ?? ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtQty(r.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {moving && <MoveSheet group={moving} targets={(moveTargets ?? []).filter((t) => t.label !== moving.label)} onClose={() => setMoving(null)} />}
    </div>
  );
}

// One pickable piece: a serial unit, a lot, or the plain quantity of a product
type Pick = { id: string; productId: string; code: string; desc: string | null; uom: string | null; max: number; lotNo: string | null; unitId: string | null; sub: string | null };

function MoveSheet({ group, targets, onClose }: { group: Group; targets: MoveTarget[]; onClose: () => void }) {
  const router = useRouter();
  const [to, setTo] = useState(targets[0]?.label ?? "");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const picks: Pick[] = group.rows.flatMap((r): Pick[] => {
    const base = { productId: r.productId, code: r.productCode, desc: r.description, uom: r.uom };
    if (r.units.length) return r.units.map((u) => ({ ...base, id: `u:${u.id}`, max: 1, lotNo: null, unitId: u.id, sub: `SN ${u.serialNo} · ${unitUseLabel(u.intendedUse).toLowerCase()}` }));
    if (r.lots.length) {
      const inLots = r.lots.reduce((a, l) => a + l.qty, 0);
      const lotPicks = r.lots.map((l) => ({ ...base, id: `l:${r.productId}:${l.lotNo}`, max: l.qty, lotNo: l.lotNo, unitId: null, sub: `Lot ${l.lotNo}${fmtDate(l.expiryDate) ? ` · exp ${fmtDate(l.expiryDate)}` : ""}` }));
      // Any quantity not recorded under a lot can still be moved on its own
      return r.qty - inLots > 1e-9 ? [...lotPicks, { ...base, id: `p:${r.productId}`, max: r.qty - inLots, lotNo: null, unitId: null, sub: "No lot" }] : lotPicks;
    }
    return [{ ...base, id: `p:${r.productId}`, max: r.qty, lotNo: null, unitId: null, sub: null }];
  });

  const chosen = picks.filter((p) => parseFloat(qty[p.id] ?? "") > 0);
  const over = chosen.filter((p) => parseFloat(qty[p.id]) > p.max + 1e-9);
  const dest = targets.find((t) => t.label === to);

  async function submit() {
    if (!to || !chosen.length || over.length) return;
    setSaving(true);
    try {
      const res = await moveConsignedStock({
        ownerOrgId: group.ownerOrgId, fromLabel: group.label, toLabel: to,
        items: chosen.map((p) => p.unitId
          ? { productId: p.productId, unitIds: [p.unitId], qty: 1 }
          : { productId: p.productId, lotNo: p.lotNo, qty: parseFloat(qty[p.id]) }),
      });
      if (!res.ok) {
        toast.error(res.title, res.details?.length ? { description: <ul className="mt-1 space-y-0.5">{res.details.map((d) => <li key={d}>• {d}</li>)}</ul>, duration: 10000 } : undefined);
        return;
      }
      toast.success(`Moved ${fmtQty(res.moved)} to ${dest?.name ?? "the new location"} — still ${group.owner}'s stock`);
      onClose();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-xl overflow-y-auto px-5">
        <SheetHeader className="px-0">
          <SheetTitle>Move consigned stock</SheetTitle>
          <p className="text-xs text-muted-foreground">
            From <span className="font-medium text-foreground">{group.location}</span> · Owner {group.owner}. It stays {group.owner}&apos;s stock — only where it is changes, and {group.owner} sees the new location.
          </p>
        </SheetHeader>

        <div className="space-y-4 pb-6">
          <div>
            <label className="text-xs font-medium">Move to</label>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {targets.map((t) => <option key={t.label} value={t.label}>{t.name === "Warehouse" ? "Warehouse" : `Specialist — ${t.name}`}</option>)}
            </select>
          </div>

          <div className="rounded-lg border border-border divide-y divide-border/60">
            {picks.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs font-medium">{p.code}</div>
                  <div className="text-xs text-muted-foreground truncate">{p.desc}</div>
                  {p.sub && <div className="text-[11px] text-muted-foreground font-mono">{p.sub}</div>}
                </div>
                {p.unitId ? (
                  <label className="flex items-center gap-1.5 text-xs shrink-0">
                    <input type="checkbox" checked={qty[p.id] === "1"} onChange={(e) => setQty((q) => ({ ...q, [p.id]: e.target.checked ? "1" : "" }))} /> move
                  </label>
                ) : (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Input type="number" min={0} max={p.max} step="any" inputMode="decimal" value={qty[p.id] ?? ""} placeholder="0"
                      onChange={(e) => setQty((q) => ({ ...q, [p.id]: e.target.value }))}
                      className={`h-8 w-20 text-right ${parseFloat(qty[p.id] ?? "") > p.max + 1e-9 ? "border-destructive" : ""}`} />
                    <span className="text-[11px] text-muted-foreground w-16">of {fmtQty(p.max)} {p.uom ?? ""}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {over.length > 0 && <p className="text-xs text-destructive">More than is here: {over.map((p) => `${p.code}${p.sub ? ` (${p.sub})` : ""}`).join(", ")}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving || !to || !chosen.length || over.length > 0}>
              {saving ? "Moving…" : `Move ${chosen.length ? `${chosen.length} item${chosen.length > 1 ? "s" : ""}` : ""}${dest ? ` to ${dest.name}` : ""}`}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
