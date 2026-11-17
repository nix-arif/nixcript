"use client";

import { useState } from "react";
import { toast } from "sonner";
import { saveIntercompanyPricingRule, deleteIntercompanyPricingRule, applyIntercompanyPricingRules, type ApplyScope, type PricingRuleRow } from "@/server/intercompany-pricing";
import type { RestrictedSupplierRule } from "@/server/supplier-restrictions";
import { PRICING_METHODS, PERCENT_LABEL, pricingMethodLabel, usesPercent, type PricingMethod } from "@/lib/intercompany/methods";
import type { PricingData } from "./supplier-rules-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowRightIcon, CheckIcon, EyeIcon, FactoryIcon, PencilIcon } from "lucide-react";

// supplierName null = the general rule of a seller; otherwise an exception for that supplier
type Target = { sellerId: string; buyerId: string | null; supplierName: string | null };
type Scope = "row" | "seller" | "all"; // "seller": all rows of the seller (or of the supplier, for an exception)

const norm = (s: string | null) => (s ? s.trim().toLowerCase() : null);
const TAG_SET = "border-indigo-200 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400";
const TAG_EXCEPTION = "border-amber-300 bg-amber-50 font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300";
const TAG_PLAIN = "border-dashed border-border text-muted-foreground";

export function PricingRulesPanel({
  canManage, data, supplierRules, reload, goToPrices,
}: {
  canManage: boolean;
  data: PricingData;
  supplierRules: RestrictedSupplierRule[];
  reload: () => Promise<void>;
  goToPrices: () => void;
}) {
  const { orgs, rules } = data;
  const [target, setTarget] = useState<Target | null>(null);
  const [method, setMethod] = useState<PricingMethod>("manual");
  const [pct, setPct] = useState("");
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<Scope>("row");

  const nameOf = (id: string) => orgs.find((o) => o.id === id)?.name ?? "—";
  const exact = (sellerId: string, buyerId: string | null, supplierName: string | null): PricingRuleRow | undefined =>
    rules.find((r) => r.sellerOrganizationId === sellerId && (r.buyerOrganizationId ?? null) === buyerId && (r.supplierNameNormalized ?? null) === norm(supplierName));

  // what applies when the user does not choose on the PO: this buyer's rule, else the "any other organization" rule
  function general(sellerId: string, buyerId: string) {
    const pair = exact(sellerId, buyerId, null);
    if (pair) return { rule: pair, from: "pair" as const };
    const any = exact(sellerId, null, null);
    return any ? { rule: any, from: "any" as const } : { rule: undefined, from: "none" as const };
  }
  // for a supplier: its own rule for this buyer, else its rule for any buyer, else the general result
  function forSupplier(sellerId: string, buyerId: string, supplierName: string) {
    const own = exact(sellerId, buyerId, supplierName);
    if (own) return { rule: own, from: "exception" as const };
    const ownAny = exact(sellerId, null, supplierName);
    if (ownAny) return { rule: ownAny, from: "exception-any" as const };
    return { ...general(sellerId, buyerId), from: "default" as const, fallback: general(sellerId, buyerId) };
  }

  // the rule that applies to a row: its own, else the broader one it falls back to
  function effectiveRule(t: Target): { rule: PricingRuleRow | undefined; own: boolean } {
    const own = exact(t.sellerId, t.buyerId, t.supplierName);
    if (own) return { rule: own, own: true };
    if (t.supplierName) {
      const anyBuyer = t.buyerId ? exact(t.sellerId, null, t.supplierName) : undefined;
      if (anyBuyer) return { rule: anyBuyer, own: false };
    }
    if (t.buyerId === null && !t.supplierName) return { rule: undefined, own: false };
    const gen = t.buyerId ? general(t.sellerId, t.buyerId).rule : exact(t.sellerId, null, null);
    return { rule: gen, own: false };
  }

  function open(t: Target) {
    // a manager edits the row's own rule; a viewer sees what applies to the row
    const r = canManage ? exact(t.sellerId, t.buyerId, t.supplierName) : effectiveRule(t).rule;
    setTarget(t);
    setScope("row");
    setMethod((r?.method as PricingMethod) ?? "manual");
    setPct(r?.marginPct ?? "");
  }

  // how many rows the chosen scope covers, and how many of them already have a rule that would be replaced
  function scopeInfo(t: Target, sc: Scope) {
    if (sc === "row") return { rows: 1, replacing: exact(t.sellerId, t.buyerId, t.supplierName) ? 1 : 0 };
    if (sc === "all") return { rows: orgs.length * orgs.length, replacing: rules.filter((r) => !r.supplierNameNormalized).length };
    return {
      rows: orgs.length,
      replacing: rules.filter((r) => r.sellerOrganizationId === t.sellerId && (r.supplierNameNormalized ?? null) === norm(t.supplierName)).length,
    };
  }

  async function save() {
    if (!target || !canManage) return;
    const info = scopeInfo(target, scope);
    if (scope !== "row" && info.replacing > 0 && !confirm(`This replaces ${info.replacing} rule${info.replacing === 1 ? "" : "s"} you already set. Continue?`)) return;
    setSaving(true);
    try {
      if (scope === "row") {
        await saveIntercompanyPricingRule({ sellerOrganizationId: target.sellerId, buyerOrganizationId: target.buyerId, supplierName: target.supplierName, method, marginPct: pct });
        toast.success(target.supplierName ? "Exception saved" : "Pricing rule saved");
      } else {
        const sc: ApplyScope = scope === "all"
          ? { kind: "all_sellers" }
          : target.supplierName
            ? { kind: "supplier_all", sellerOrganizationId: target.sellerId, supplierName: target.supplierName }
            : { kind: "seller_all", sellerOrganizationId: target.sellerId };
        const r = await applyIntercompanyPricingRules({ scope: sc, method, marginPct: pct });
        toast.success(`Applied to ${r.added + r.replaced} rows (${r.added} added, ${r.replaced} replaced)`);
      }
      await reload();
      setTarget(null);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  async function remove() {
    const r = target && exact(target.sellerId, target.buyerId, target.supplierName);
    if (!r) return;
    setSaving(true);
    try { await deleteIntercompanyPricingRule(r.id); await reload(); setTarget(null); toast.success(target?.supplierName ? "Back to the default" : "Rule removed"); }
    catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  const existing = target ? exact(target.sellerId, target.buyerId, target.supplierName) : undefined;
  const label = (r?: PricingRuleRow) => (r ? pricingMethodLabel(r.method, r.marginPct) : "Manual price");
  // one matrix per (seller, supplier) pair, even if the seller handles the supplier in more than one period
  const handled = [...new Map(
    supplierRules.filter((s) => orgs.some((o) => o.id === s.designatedOrganizationId)).map((s) => [`${s.designatedOrganizationId}|${s.supplierNameNormalized}`, s]),
  ).values()];
  const bySeller = orgs.map((o) => ({ org: o, suppliers: handled.filter((s) => s.designatedOrganizationId === o.id) })).filter((g) => g.suppliers.length > 0);

  return (
    <div className="space-y-6 pt-1">
      <p className="max-w-2xl text-sm text-muted-foreground">
        When one of your organizations raises a PO to another, the user can pick the price method on the PO. If they don&apos;t, the rules below apply. {canManage ? "Click a row to change what a seller charges a buyer." : "Click a row to see the options and what applies. You can view these rules but not change them."}
      </p>

      {/* ── the general rule of each seller ── */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Default pricing</h2>
        {orgs.map((seller) => (
          <section key={seller.id} className="overflow-hidden rounded-xl border border-border">
            <header className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
              <span className="text-sm font-semibold">{seller.name}</span>
              <span className="text-xs text-muted-foreground">sells to</span>
            </header>
            <ul className="divide-y divide-border/60">
              {[...orgs.filter((o) => o.id !== seller.id).map((b) => ({ id: b.id as string | null, name: b.name })), { id: null as string | null, name: "Any other organization" }].map((b) => {
                const isAny = b.id === null;
                const eff = isAny ? { rule: exact(seller.id, null, null), from: exact(seller.id, null, null) ? ("pair" as const) : ("none" as const) } : general(seller.id, b.id!);
                return (
                  <li key={b.id ?? "any"}>
                    <button type="button" onClick={() => open({ sellerId: seller.id, buyerId: b.id, supplierName: null })}
                      className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/30">
                      <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className={`min-w-0 flex-1 text-sm ${isAny ? "text-muted-foreground" : "font-medium"}`}>{b.name}</span>
                      <span className={`rounded-md border px-2 py-0.5 text-xs ${eff.from === "pair" ? TAG_SET : TAG_PLAIN}`}>{label(eff.rule)}</span>
                      {eff.from === "any" && <span className="hidden text-[11px] text-muted-foreground sm:inline">from &ldquo;any other&rdquo;</span>}
                      {eff.from === "none" && !isAny && <span className="hidden text-[11px] text-muted-foreground sm:inline">no rule</span>}
                      {canManage ? <PencilIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" /> : <EyeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* ── exceptions: a supplier a sibling handles that is priced differently from the default ── */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Exceptions by supplier</h2>
          <p className="max-w-2xl text-xs text-muted-foreground">
            A supplier that one organization handles can be priced differently from that organization&apos;s default. The exception applies to POs that were routed because of this supplier.
          </p>
        </div>

        {bySeller.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <FactoryIcon className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm font-medium">No supplier is handled by another organization yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Add a rule under Supplier handling, then it appears here so you can give it its own pricing.</p>
          </div>
        ) : bySeller.map(({ org: seller, suppliers }) => suppliers.map((sup) => (
          <section key={sup.id} className="overflow-hidden rounded-xl border border-border">
            <header className="flex flex-wrap items-center gap-2 border-b border-border bg-amber-50/50 px-4 py-2.5 dark:bg-amber-900/10">
              <FactoryIcon className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              <span className="text-sm font-semibold">{sup.supplierName}</span>
              <span className="text-xs text-muted-foreground">handled by {seller.name}, which sells to</span>
            </header>
            <ul className="divide-y divide-border/60">
              {[...orgs.filter((o) => o.id !== seller.id).map((b) => ({ id: b.id as string | null, name: b.name })), { id: null as string | null, name: "Any other organization" }].map((b) => {
                const isAny = b.id === null;
                const eff = isAny
                  ? (exact(seller.id, null, sup.supplierName) ? { rule: exact(seller.id, null, sup.supplierName), from: "exception" as const } : { rule: undefined, from: "default" as const })
                  : forSupplier(seller.id, b.id!, sup.supplierName);
                const dflt = isAny ? exact(seller.id, null, null) : general(seller.id, b.id!).rule;
                return (
                  <li key={b.id ?? "any"}>
                    <button type="button" onClick={() => open({ sellerId: seller.id, buyerId: b.id, supplierName: sup.supplierName })}
                      className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/30">
                      <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className={`min-w-0 flex-1 text-sm ${isAny ? "text-muted-foreground" : "font-medium"}`}>{b.name}</span>
                      {eff.from === "default" ? (
                        <span className={`rounded-md border px-2 py-0.5 text-xs ${TAG_PLAIN}`}>Default: {label(dflt)}</span>
                      ) : (
                        <>
                          <span className={`rounded-md border px-2 py-0.5 text-xs ${TAG_EXCEPTION}`}>{label(eff.rule)}</span>
                          <span className="hidden text-[11px] text-muted-foreground sm:inline">{eff.from === "exception-any" ? "exception for any other" : `instead of ${label(dflt)}`}</span>
                        </>
                      )}
                      {canManage ? <PencilIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" /> : <EyeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Order of precedence: the method chosen on the PO, then the supplier&apos;s exception for that buyer, the supplier&apos;s exception for any buyer, the seller&apos;s default for that buyer, the seller&apos;s default for any buyer, and finally the prices typed on the PO. Methods that use the seller&apos;s product table or price list need those prices filled in (see <button type="button" className="underline" onClick={goToPrices}>Price list</button>).
      </p>

      <Sheet open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <SheetContent className="w-full max-w-lg! overflow-y-auto px-8 sm:max-w-md">
          {target && (
            <>
              <SheetHeader className="mb-5">
                <SheetTitle>
                  {target.supplierName ? `${target.supplierName}: ` : ""}{nameOf(target.sellerId)} sells to {target.buyerId ? nameOf(target.buyerId) : "any other organization"}
                </SheetTitle>
                <SheetDescription>
                  {!canManage
                    ? (() => {
                        const e = effectiveRule(target);
                        return e.own ? "The method set for this row. You can view it but not change it."
                          : e.rule ? "This row has no rule of its own, so it uses a broader rule. You can view it but not change it."
                          : "No rule applies to this row, so the prices typed on the PO stay. You can view this but not change it.";
                      })()
                    : target.supplierName
                      ? `How POs for ${target.supplierName} are priced. Remove the exception to use the default again.`
                      : "How the PO lines are priced when the user does not choose a method."}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4">
                <div className="grid gap-1.5">
                  {PRICING_METHODS.map((m) => (
                    <button key={m.value} type="button" aria-pressed={method === m.value} onClick={() => canManage && setMethod(m.value)}
                      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${canManage ? "" : "cursor-default"} ${method === m.value ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" : canManage ? "border-border hover:bg-muted/30" : "border-border"}`}>
                      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${method === m.value ? "border-indigo-500 bg-indigo-500 text-white" : "border-border"}`}>
                        {method === m.value && <CheckIcon className="h-3 w-3" />}
                      </span>
                      <span>
                        <span className="block text-sm font-medium">{m.label}{!canManage && method === m.value && <span className="ml-2 rounded bg-indigo-100 px-1.5 py-px text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">Applies</span>}</span>
                        <span className="block text-xs text-muted-foreground">{m.help}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {usesPercent(method) && (
                  <div className="space-y-1.5">
                    <Label>{PERCENT_LABEL[method]}</Label>
                    <div className="flex items-center gap-2">
                      <Input type="number" min="0" step="0.01" className="w-28 tabular-nums" value={pct} readOnly={!canManage} onChange={(e) => setPct(e.target.value)} autoFocus={canManage} />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                )}
                {canManage && (
                <div className="space-y-1.5">
                  <Label>Apply to</Label>
                  <div className="grid gap-1.5">
                    {([
                      ["row", "This row only", ""],
                      ["seller", target.supplierName ? `Every buyer of ${target.supplierName}` : `Every buyer of ${nameOf(target.sellerId)}`, `${scopeInfo(target, "seller").rows} rows`],
                      ...(target.supplierName ? [] : [["all", "All organizations", `${scopeInfo(target, "all").rows} rows, every seller to every buyer`]]),
                    ] as [Scope, string, string][]).map(([v, text, sub]) => (
                      <button key={v} type="button" aria-pressed={scope === v} onClick={() => setScope(v)}
                        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${scope === v ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" : "border-border hover:bg-muted/30"}`}>
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${scope === v ? "border-indigo-500 bg-indigo-500 text-white" : "border-border"}`}>
                          {scope === v && <CheckIcon className="h-3 w-3" />}
                        </span>
                        <span className="flex-1">{text}</span>
                        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
                      </button>
                    ))}
                  </div>
                  {scope !== "row" && scopeInfo(target, scope).replacing > 0 && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      Replaces {scopeInfo(target, scope).replacing} rule{scopeInfo(target, scope).replacing === 1 ? "" : "s"} you already set.
                    </p>
                  )}
                </div>
                )}
                {!canManage && (
                  <div className="pt-2"><Button variant="outline" className="w-full" onClick={() => setTarget(null)}>Close</Button></div>
                )}
                {canManage && (
                <div className="flex gap-2 pt-2">
                  <Button className="flex-1" onClick={save} disabled={saving}>
                    {saving ? "Saving…" : scope !== "row" ? `Apply to ${scopeInfo(target, scope).rows} rows` : target.supplierName ? "Save exception" : "Save rule"}
                  </Button>
                  {existing && <Button variant="outline" onClick={remove} disabled={saving}>{target.supplierName ? "Use the default" : "Remove rule"}</Button>}
                </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
