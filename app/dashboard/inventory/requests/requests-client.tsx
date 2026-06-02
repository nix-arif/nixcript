"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlusIcon, CheckIcon, XIcon, SettingsIcon, PackageIcon } from "lucide-react";
import {
  createStockRequest, approveStockRequest, rejectStockRequest,
  setStaffStockLimit, deleteStaffStockLimit,
} from "@/server/stock-request";
import { searchProducts } from "@/server/inventory";
import type { StockRequestWithMeta, StaffAllocation, StaffStockLimitRow } from "@/server/stock-request";
import type { Warehouse } from "@/server/inventory";

type Limit = StaffStockLimitRow & { userName: string | null; productCode: string | null };
type StaffMember = { userId: string; name: string | null; email: string };

const STATUS_STYLE: Record<string, string> = {
  pending:   "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400",
  approved:  "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-900/20 dark:text-blue-400",
  fulfilled: "bg-green-50 text-green-700 border-green-300 dark:bg-green-900/20 dark:text-green-400",
  rejected:  "bg-red-50 text-red-700 border-red-300 dark:bg-red-900/20 dark:text-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", approved: "Approved", fulfilled: "Fulfilled", rejected: "Rejected",
};

function fmt(n: number) {
  return n.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleString("en-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface Props {
  requests: StockRequestWithMeta[];
  allocations: StaffAllocation[];
  limits: Limit[];
  warehouses: Warehouse[];
  staffMembers: StaffMember[];
  permissions: string[];
  canApprove: boolean;
  canManage: boolean;
  canRequest: boolean;
}

export function StockRequestsClient({
  requests, allocations, limits, warehouses, staffMembers, canApprove, canManage, canRequest,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // ── Request sheet ──────────────────────────────────────────────────────
  const [reqOpen, setReqOpen] = useState(false);
  const [reqProductId, setReqProductId] = useState("");
  const [reqProductLabel, setReqProductLabel] = useState("");
  const [reqQty, setReqQty] = useState("");
  const [reqWarehouse, setReqWarehouse] = useState(warehouses[0]?.label ?? "Default");
  const [reqNotes, setReqNotes] = useState("");
  const [reqSaving, setReqSaving] = useState(false);

  // product search
  const [prodQuery, setProdQuery] = useState("");
  const [prodResults, setProdResults] = useState<{ id: string; productCode: string; description: string | null }[]>([]);
  const [prodOpen, setProdOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleProdInput(q: string) {
    setProdQuery(q);
    setReqProductId(""); setReqProductLabel("");
    if (debounce.current) clearTimeout(debounce.current);
    if (!q.trim()) { setProdResults([]); setProdOpen(false); return; }
    debounce.current = setTimeout(async () => {
      const r = await searchProducts(q);
      setProdResults(r); setProdOpen(r.length > 0);
      const exact = r.find((p) => p.productCode.toLowerCase() === q.trim().toLowerCase());
      if (exact) pickProduct(exact);
    }, 300);
  }

  function pickProduct(p: { id: string; productCode: string; description: string | null }) {
    setReqProductId(p.id);
    setReqProductLabel(`${p.productCode}${p.description ? ` — ${p.description}` : ""}`);
    setProdQuery(""); setProdResults([]); setProdOpen(false);
  }

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!reqProductId) { toast.error("Select a product"); return; }
    const qty = parseFloat(reqQty);
    if (isNaN(qty) || qty <= 0) { toast.error("Enter a valid quantity"); return; }
    setReqSaving(true);
    try {
      await createStockRequest({ productId: reqProductId, qty, warehouseFrom: reqWarehouse, notes: reqNotes || undefined });
      toast.success("Stock request submitted");
      setReqOpen(false);
      setReqProductId(""); setReqProductLabel(""); setReqQty(""); setReqNotes("");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setReqSaving(false); }
  }

  // ── Approve sheet ──────────────────────────────────────────────────────
  const [approveReq, setApproveReq] = useState<StockRequestWithMeta | null>(null);
  const [approveQty, setApproveQty] = useState("");
  const [approveNotes, setApproveNotes] = useState("");
  const [approveSaving, setApproveSaving] = useState(false);

  async function handleApprove(e: React.FormEvent) {
    e.preventDefault();
    if (!approveReq) return;
    const qty = parseFloat(approveQty);
    if (isNaN(qty) || qty <= 0) { toast.error("Enter a valid quantity"); return; }
    setApproveSaving(true);
    try {
      await approveStockRequest(approveReq.id, qty, approveNotes || undefined);
      toast.success("Request approved — stock transferred");
      setApproveReq(null); setApproveQty(""); setApproveNotes("");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setApproveSaving(false); }
  }

  // ── Reject ─────────────────────────────────────────────────────────────
  const [rejectReq, setRejectReq] = useState<StockRequestWithMeta | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSaving, setRejectSaving] = useState(false);

  async function handleReject(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectReq) return;
    if (!rejectReason.trim()) { toast.error("Reason is required"); return; }
    setRejectSaving(true);
    try {
      await rejectStockRequest(rejectReq.id, rejectReason);
      toast.success("Request rejected");
      setRejectReq(null); setRejectReason("");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setRejectSaving(false); }
  }

  // ── Limit sheet ────────────────────────────────────────────────────────
  const [limitOpen, setLimitOpen] = useState(false);
  const [limitUserId, setLimitUserId] = useState(staffMembers[0]?.userId ?? "");
  const [limitProductId, setLimitProductId] = useState("");
  const [limitProductLabel, setLimitProductLabel] = useState("");
  const [limitQty, setLimitQty] = useState("");
  const [limitSaving, setLimitSaving] = useState(false);

  const [limitProdQuery, setLimitProdQuery] = useState("");
  const [limitProdResults, setLimitProdResults] = useState<{ id: string; productCode: string; description: string | null }[]>([]);
  const [limitProdOpen, setLimitProdOpen] = useState(false);
  const limitDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleLimitProdInput(q: string) {
    setLimitProdQuery(q); setLimitProductId(""); setLimitProductLabel("");
    if (limitDebounce.current) clearTimeout(limitDebounce.current);
    if (!q.trim()) { setLimitProdResults([]); setLimitProdOpen(false); return; }
    limitDebounce.current = setTimeout(async () => {
      const r = await searchProducts(q);
      setLimitProdResults(r); setLimitProdOpen(r.length > 0);
      const exact = r.find((p) => p.productCode.toLowerCase() === q.trim().toLowerCase());
      if (exact) { setLimitProductId(exact.id); setLimitProductLabel(`${exact.productCode}${exact.description ? ` — ${exact.description}` : ""}`); setLimitProdQuery(""); setLimitProdResults([]); setLimitProdOpen(false); }
    }, 300);
  }

  async function handleSetLimit(e: React.FormEvent) {
    e.preventDefault();
    if (!limitUserId) { toast.error("Select a staff member"); return; }
    if (!limitProductId) { toast.error("Select a product"); return; }
    const qty = parseFloat(limitQty);
    if (isNaN(qty) || qty < 0) { toast.error("Enter a valid max quantity"); return; }
    setLimitSaving(true);
    try {
      await setStaffStockLimit({ userId: limitUserId, productId: limitProductId, maxQty: qty });
      toast.success("Holding limit saved");
      setLimitOpen(false);
      setLimitProductId(""); setLimitProductLabel(""); setLimitQty("");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setLimitSaving(false); }
  }

  async function handleDeleteLimit(id: string) {
    try {
      await deleteStaffStockLimit(id);
      toast.success("Limit removed");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const tabs = ["allocations", "requests", ...(canManage ? ["limits"] : [])] as const;
  type Tab = typeof tabs[number];
  const [activeTab, setActiveTab] = useState<Tab>("allocations");

  const TAB_LABEL: Record<string, string> = { allocations: "Current Allocations", requests: "Requests", limits: "Holding Limits" };

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <PackageIcon className="h-5 w-5 text-muted-foreground" />Field Stock
          </h1>
          <p className="text-sm text-muted-foreground">Stock allocated to field staff for faster customer response</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setLimitOpen(true)} className="gap-1.5">
              <SettingsIcon className="h-4 w-4" />Set Limit
            </Button>
          )}
          {canRequest && (
            <Button size="sm" onClick={() => setReqOpen(true)} className="gap-1.5">
              <PlusIcon className="h-4 w-4" />Request Stock
            </Button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABEL[t]}
            {t === "requests" && pendingCount > 0 && (
              <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">{pendingCount}</Badge>
            )}
          </button>
        ))}
      </div>

      {/* ── Allocations tab ──────────────────────────────────────────── */}
      {activeTab === "allocations" && (
        <div>
          {allocations.length === 0 ? (
            <div className="rounded-lg border border-border py-16 text-center text-sm text-muted-foreground">
              No field stock currently allocated.
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Staff</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-16 text-center">UOM</TableHead>
                    <TableHead className="text-right w-28">On Hand</TableHead>
                    <TableHead className="text-right w-28">Max Limit</TableHead>
                    <TableHead className="text-right w-28">Utilisation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allocations.map((a, i) => {
                    const pct = a.maxQty ? Math.min(100, (a.onHand / a.maxQty) * 100) : null;
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-medium text-sm">{a.userName}</TableCell>
                        <TableCell className="font-mono text-xs">{a.productCode}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{a.description ?? "—"}</TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">{a.uom ?? "—"}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{fmt(a.onHand)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{a.maxQty ? fmt(a.maxQty) : "—"}</TableCell>
                        <TableCell className="text-right">
                          {pct !== null ? (
                            <span className={`text-xs font-medium ${pct >= 90 ? "text-red-600 dark:text-red-400" : pct >= 70 ? "text-amber-600 dark:text-amber-400" : "text-green-700 dark:text-green-400"}`}>
                              {pct.toFixed(0)}%
                            </span>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* ── Requests tab ─────────────────────────────────────────────── */}
      {activeTab === "requests" && (
        <div>
          {requests.length === 0 ? (
            <div className="rounded-lg border border-border py-16 text-center text-sm text-muted-foreground">
              No stock requests yet.
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Date</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right w-24">Requested</TableHead>
                    <TableHead className="text-right w-24">Approved</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    {canApprove && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.createdAt)}</TableCell>
                      <TableCell className="text-sm font-medium">{r.requestedByName ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.productCode}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmt(parseFloat(r.qty))}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{r.approvedQty ? fmt(parseFloat(r.approvedQty)) : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.warehouseFrom}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-48 truncate" title={r.notes ?? r.approvedNotes ?? ""}>{r.notes || r.approvedNotes || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${STATUS_STYLE[r.status] ?? ""}`}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                      </TableCell>
                      {canApprove && (
                        <TableCell>
                          {r.status === "pending" && (
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:text-green-700" title="Approve"
                                onClick={() => { setApproveReq(r); setApproveQty(r.qty); }}>
                                <CheckIcon className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" title="Reject"
                                onClick={() => setRejectReq(r)}>
                                <XIcon className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* ── Limits tab ───────────────────────────────────────────────── */}
      {activeTab === "limits" && canManage && (
        <div>
          {limits.length === 0 ? (
            <div className="rounded-lg border border-border py-16 text-center text-sm text-muted-foreground">
              No holding limits set. Use "Set Limit" to restrict how much stock a staff member can hold.
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Staff</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right w-28">Max Qty</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {limits.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-sm font-medium">{l.userName ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{l.productCode ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{fmt(parseFloat(l.maxQty))}</TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDeleteLimit(l.id)}>
                          <XIcon className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* ── Request Stock Sheet ──────────────────────────────────────────── */}
      <Sheet open={reqOpen} onOpenChange={(o) => { if (!reqSaving) setReqOpen(o); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto px-8">
          <SheetHeader className="mb-5"><SheetTitle>Request Stock Allocation</SheetTitle></SheetHeader>
          <form onSubmit={handleRequest} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Source Warehouse <span className="text-destructive">*</span></Label>
              <Select value={reqWarehouse} onValueChange={setReqWarehouse}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {warehouses.filter((w) => !w.label.startsWith("Field -")).map((w) => (
                    <SelectItem key={w.label} value={w.label}>{w.label}{w.address ? ` — ${w.address}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Product <span className="text-destructive">*</span></Label>
              {reqProductLabel ? (
                <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <span className="flex-1 truncate font-mono text-xs">{reqProductLabel}</span>
                  <button type="button" onClick={() => { setReqProductId(""); setReqProductLabel(""); }} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
                </div>
              ) : (
                <div className="relative">
                  <Input placeholder="Type product code or name…" value={prodQuery} onChange={(e) => handleProdInput(e.target.value)} autoComplete="off" />
                  {prodOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-md max-h-48 overflow-y-auto">
                      {prodResults.map((p) => (
                        <button key={p.id} type="button" className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex gap-2" onClick={() => pickProduct(p)}>
                          <span className="font-mono font-medium">{p.productCode}</span>
                          <span className="text-muted-foreground truncate">{p.description ?? ""}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Quantity <span className="text-destructive">*</span></Label>
              <Input type="number" min="0.0001" step="0.0001" placeholder="0" value={reqQty} onChange={(e) => setReqQty(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Notes <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
              <Textarea placeholder="Why you need this stock…" value={reqNotes} onChange={(e) => setReqNotes(e.target.value)} rows={2} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={reqSaving} className="flex-1">{reqSaving ? "Submitting…" : "Submit Request"}</Button>
              <Button type="button" variant="outline" onClick={() => setReqOpen(false)} disabled={reqSaving}>Cancel</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* ── Approve Sheet ────────────────────────────────────────────────── */}
      <Sheet open={!!approveReq} onOpenChange={(o) => { if (!approveSaving && !o) setApproveReq(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto px-8">
          <SheetHeader className="mb-5"><SheetTitle>Approve Stock Request</SheetTitle></SheetHeader>
          {approveReq && (
            <form onSubmit={handleApprove} className="flex flex-col gap-4">
              <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">Staff:</span> {approveReq.requestedByName}</p>
                <p><span className="text-muted-foreground">Product:</span> <span className="font-mono">{approveReq.productCode}</span></p>
                <p><span className="text-muted-foreground">Requested:</span> {fmt(parseFloat(approveReq.qty))} units</p>
                <p><span className="text-muted-foreground">From:</span> {approveReq.warehouseFrom}</p>
                {approveReq.notes && <p><span className="text-muted-foreground">Notes:</span> {approveReq.notes}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Approved Quantity <span className="text-destructive">*</span></Label>
                <Input type="number" min="0.0001" step="0.0001" value={approveQty} onChange={(e) => setApproveQty(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Notes <span className="text-muted-foreground font-normal text-xs">(opt)</span></Label>
                <Textarea placeholder="Any instructions…" value={approveNotes} onChange={(e) => setApproveNotes(e.target.value)} rows={2} />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={approveSaving} className="flex-1">{approveSaving ? "Approving…" : "Approve & Transfer Stock"}</Button>
                <Button type="button" variant="outline" onClick={() => setApproveReq(null)} disabled={approveSaving}>Cancel</Button>
              </div>
            </form>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Reject Sheet ─────────────────────────────────────────────────── */}
      <Sheet open={!!rejectReq} onOpenChange={(o) => { if (!rejectSaving && !o) setRejectReq(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto px-8">
          <SheetHeader className="mb-5"><SheetTitle>Reject Stock Request</SheetTitle></SheetHeader>
          {rejectReq && (
            <form onSubmit={handleReject} className="flex flex-col gap-4">
              <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">Staff:</span> {rejectReq.requestedByName}</p>
                <p><span className="text-muted-foreground">Product:</span> <span className="font-mono">{rejectReq.productCode}</span></p>
                <p><span className="text-muted-foreground">Requested:</span> {fmt(parseFloat(rejectReq.qty))} units</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Reason <span className="text-destructive">*</span></Label>
                <Textarea placeholder="Why this request is rejected…" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" variant="destructive" disabled={rejectSaving} className="flex-1">{rejectSaving ? "Rejecting…" : "Reject Request"}</Button>
                <Button type="button" variant="outline" onClick={() => setRejectReq(null)} disabled={rejectSaving}>Cancel</Button>
              </div>
            </form>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Set Limit Sheet ──────────────────────────────────────────────── */}
      <Sheet open={limitOpen} onOpenChange={(o) => { if (!limitSaving) setLimitOpen(o); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto px-8">
          <SheetHeader className="mb-5"><SheetTitle>Set Holding Limit</SheetTitle></SheetHeader>
          <form onSubmit={handleSetLimit} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">Restrict how much of a product a staff member can hold at one time. Requests that would exceed this limit will be blocked.</p>
            <div className="flex flex-col gap-1.5">
              <Label>Staff Member <span className="text-destructive">*</span></Label>
              <Select value={limitUserId} onValueChange={setLimitUserId}>
                <SelectTrigger><SelectValue placeholder="Select staff…" /></SelectTrigger>
                <SelectContent>
                  {staffMembers.map((s) => (
                    <SelectItem key={s.userId} value={s.userId}>{s.name ?? s.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Product <span className="text-destructive">*</span></Label>
              {limitProductLabel ? (
                <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <span className="flex-1 truncate font-mono text-xs">{limitProductLabel}</span>
                  <button type="button" onClick={() => { setLimitProductId(""); setLimitProductLabel(""); }} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
                </div>
              ) : (
                <div className="relative">
                  <Input placeholder="Type product code or name…" value={limitProdQuery} onChange={(e) => handleLimitProdInput(e.target.value)} autoComplete="off" />
                  {limitProdOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-md max-h-48 overflow-y-auto">
                      {limitProdResults.map((p) => (
                        <button key={p.id} type="button" className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex gap-2"
                          onClick={() => { setLimitProductId(p.id); setLimitProductLabel(`${p.productCode}${p.description ? ` — ${p.description}` : ""}`); setLimitProdQuery(""); setLimitProdResults([]); setLimitProdOpen(false); }}>
                          <span className="font-mono font-medium">{p.productCode}</span>
                          <span className="text-muted-foreground truncate">{p.description ?? ""}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Maximum Quantity <span className="text-destructive">*</span></Label>
              <Input type="number" min="0" step="0.0001" placeholder="e.g. 50" value={limitQty} onChange={(e) => setLimitQty(e.target.value)} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={limitSaving} className="flex-1">{limitSaving ? "Saving…" : "Save Limit"}</Button>
              <Button type="button" variant="outline" onClick={() => setLimitOpen(false)} disabled={limitSaving}>Cancel</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
