"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateCustomerPo, getNextCashSaleNo, type CpoItemInput, type CustomerPo } from "@/server/customer-purchase-order";
import { type OrgMember } from "@/server/members";
import { getCustomer } from "@/server/customer";
import { searchQuotationsByNo, getQuotationForSO } from "@/server/quotation";
import { getProductByCode } from "@/server/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { uid } from "@/lib/uid";
import {
  ArrowLeftIcon, SearchIcon, XIcon, PaperclipIcon,
  BuildingIcon, UserIcon, FileTextIcon, PlusIcon,
  PencilIcon, DatabaseIcon, LinkIcon,
} from "lucide-react";

type LinkedQuotation = {
  id: string;
  quotationNo: string;
  grandTotal: string;
  customerId?: string | null;
  customerName?: string | null;
  customerOrg?: string | null;
  customerOrgMemberId?: string | null;
  isPreloaded?: boolean;
};

type EditableItem = CpoItemInput & {
  _key: string;
  included: boolean;
  _quotationId: string;
  _quotationNo: string;
  setGroupId: string;
  setGroupLabel: string;
  setQty: string;
  _descriptionSource?: Array<"quote" | "catalog" | "user"> | null;
  _editedBy?: string | null;
  _codeSource?: "quote" | "user" | null;
  _unitPriceSource?: "quote" | "user" | null;
  _qtySource?: "quote" | "user" | null;
};

function calcItemTotal(item: EditableItem): EditableItem {
  const qty    = parseFloat(item.qty         || "0") || 0;
  const up     = parseFloat(item.unitPrice   || "0") || 0;
  const dPct   = parseFloat(item.discountPct || "0") || 0;
  const setMul = item.setGroupId ? (parseFloat(item.setQty || "1") || 1) : 1;
  const gross  = qty * up * setMul;
  return { ...item, totalPrice: (gross - (gross * dPct) / 100).toFixed(2) };
}

const STATUS_COLORS: Record<string, string> = {
  received:     "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
  acknowledged: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  fulfilled:    "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800",
  cancelled:    "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
};

function sumItems(items: EditableItem[]): string {
  return items
    .filter((i) => i.included)
    .reduce((s, i) => s + (parseFloat(i.totalPrice) || 0), 0)
    .toFixed(2);
}

export function EditCustomerPoClient({
  cpo,
  members,
  currentUserName = "",
}: {
  cpo: CustomerPo;
  members: OrgMember[];
  currentUserName?: string;
}) {
  const router = useRouter();
  const snap   = cpo.customerSnapshot as any;
  const cpoAny = cpo as any;

  // ── Quotations (multiple) ──────────────────────────────────────────────────
  const [linkedQuotations, setLinkedQuotations] = useState<LinkedQuotation[]>(() => {
    const snapName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
    const snapOrg  = snap?.organizationName ?? null;
    return ((cpoAny.quotationLinks as { quotationId: string; quotationNo: string }[] | null) ?? []).map((q, idx) => ({
      id: q.quotationId,
      quotationNo: q.quotationNo,
      grandTotal: "0",
      customerId: idx === 0 ? (cpo.customerId ?? null) : null,
      customerName: idx === 0 ? snapName : null,
      customerOrg:  idx === 0 ? snapOrg  : null,
      isPreloaded: true,
    }));
  });
  const [showAddSearch,    setShowAddSearch]    = useState(false);
  const [qtSearch,         setQtSearch]         = useState("");
  const [qtResults,        setQtResults]        = useState<Awaited<ReturnType<typeof searchQuotationsByNo>>>([]);
  const [qtHighlight,      setQtHighlight]      = useState(-1);
  const [qtLoading,        setQtLoading]        = useState(false);
  const qtTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const spInputRef = useRef<HTMLInputElement>(null);

  // ── Items ──────────────────────────────────────────────────────────────────
  const firstQtId = (cpoAny.quotationLinks as { quotationId: string }[] | null)?.[0]?.quotationId ?? "";
  const hasQuotations = firstQtId !== "";
  const [items, setItems] = useState<EditableItem[]>(() =>
    ((cpo.items as CpoItemInput[] | null) ?? []).map((item) => {
      const raw = item as any;
      return {
        ...item,
        _key: uid(),
        included: true,
        _quotationId: firstQtId,
        _quotationNo: (cpoAny.quotationLinks as { quotationNo: string }[] | null)?.[0]?.quotationNo ?? "",
        setGroupId:    item.setGroupId    ?? "",
        setGroupLabel: item.setGroupLabel ?? "",
        setQty:        item.setQty        ?? "",
        _codeSource:        raw._codeSource        ?? (hasQuotations ? "quote" : null),
        _descriptionSource: (() => {
          const s = raw._descriptionSource;
          if (s === null || s === undefined) return hasQuotations ? ["quote"] : null;
          return Array.isArray(s) ? s : [s as "quote" | "catalog" | "user"];
        })(),
        _qtySource:         raw._qtySource         ?? (hasQuotations ? "quote" : null),
        _unitPriceSource:   raw._unitPriceSource   ?? (hasQuotations ? "quote" : null),
        _editedBy:          raw._editedBy          ?? null,
      } as EditableItem;
    })
  );
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // ── PO details ─────────────────────────────────────────────────────────────
  const [customerPoNo,   setCustomerPoNo]   = useState(cpo.customerPoNo ?? "");
  const [amount,         setAmount]         = useState(cpo.amount ?? "0");
  const [amountOverride, setAmountOverride] = useState(false);
  const [currency,       setCurrency]       = useState(cpo.currency ?? "MYR");
  const [receivedDate,   setReceivedDate]   = useState(
    cpo.receivedDate ? new Date(cpo.receivedDate).toISOString().slice(0, 10) : new Date().toISOString().split("T")[0]
  );
  const [deliveryDate,    setDeliveryDate]    = useState(
    cpoAny.deliveryDate ? new Date(cpoAny.deliveryDate).toISOString().slice(0, 10) : ""
  );
  const [deliveryAddress, setDeliveryAddress] = useState(cpoAny.deliveryAddress ?? "");
  const [salesPersons, setSalesPersons] = useState<{ id: string; name: string; isExt: boolean }[]>(() => {
    const list: { id: string; name: string; isExt: boolean }[] = [];
    if (cpoAny.salesPersonName) {
      const m = members.find(x => (x.name ?? x.email)?.toLowerCase() === cpoAny.salesPersonName?.toLowerCase());
      list.push({ id: m?.userId ?? `mem-${cpoAny.salesPersonName}`, name: cpoAny.salesPersonName, isExt: !m });
    }
    ((cpoAny.associateSalesPersons as { id: string; name: string }[] | null) ?? []).forEach((a) => {
      const m = members.find(x => x.userId === a.id);
      list.push({ id: a.id, name: a.name, isExt: !m });
    });
    return list;
  });
  const [spInput, setSpInput] = useState("");
  const [status,         setStatus]         = useState(cpo.status ?? "received");
  const [notes,          setNotes]          = useState(cpo.notes ?? "");

  const [cashSaleLoading, setCashSaleLoading] = useState(false);

  // ── PDF ────────────────────────────────────────────────────────────────────
  const [existingDocKey, setExistingDocKey] = useState<string | null>(cpo.documentKey ?? null);
  const [pdfFile,      setPdfFile]      = useState<File | null>(null);
  const [pdfKey,       setPdfKey]       = useState<string | undefined>();
  const [pdfUploading, setPdfUploading] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);

  const primaryCustomer = linkedQuotations[0] ?? null;
  const isFirstQuotation = linkedQuotations.length === 0;

  // ── Quotation search ───────────────────────────────────────────────────────

  const handleQtSearch = useCallback((val: string) => {
    setQtSearch(val);
    setQtHighlight(-1);
    if (val.length < 2) { setQtResults([]); return; }
    if (qtTimer.current) clearTimeout(qtTimer.current);
    qtTimer.current = setTimeout(async () => {
      setQtResults(await searchQuotationsByNo(val, true));
      setQtHighlight(-1);
    }, 300);
  }, []);

  function handleQtKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!qtResults.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setQtHighlight((i) => Math.min(i + 1, qtResults.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setQtHighlight((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter")     { e.preventDefault(); const r = qtResults[qtHighlight] ?? qtResults[0]; if (r) selectQuotation(r.id, r.quotationNo); return; }
    if (e.key === "Escape")    { setQtResults([]); setQtHighlight(-1); setShowAddSearch(false); }
  }

  async function selectQuotation(qtId: string, qtNo: string) {
    // Prevent duplicates
    if (linkedQuotations.some((q) => q.id === qtId)) {
      toast.error("This quotation is already linked");
      setQtSearch(""); setQtResults([]);
      return;
    }

    setQtSearch(""); setQtResults([]); setQtLoading(true);
    try {
      const qt = await getQuotationForSO(qtId);
      if (!qt) return;

      let customerName: string | null = null;
      let customerOrg:  string | null = null;
      let customerOrgMemberId: string | null = null;

      if (qt.customerId) {
        try {
          const cust = await getCustomer(qt.customerId);
          if (cust) {
            customerName = [cust.title, cust.name].filter(Boolean).join(" ");
            const primary = cust.memberships.find((c) => c.isPrimary) ?? cust.memberships[0];
            customerOrg  = primary?.orgName ?? null;
            customerOrgMemberId = primary?.id ?? null;
          }
        } catch {
          const snap = qt.customerSnapshot as any;
          customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
          customerOrg  = snap?.organizationName ?? null;
        }
      } else {
        const snap = qt.customerSnapshot as any;
        customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
        customerOrg  = snap?.organizationName ?? null;
      }

      // Block if customer does not exactly match the primary quotation's customer
      if (primaryCustomer) {
        if (primaryCustomer.customerId !== qt.customerId) {
          toast.error("Cannot link — this quotation belongs to a different customer.");
          return;
        }
      }

      const linked: LinkedQuotation = {
        id: qt.id,
        quotationNo: qt.quotationNo,
        grandTotal: qt.grandTotal,
        customerId: qt.customerId,
        customerName,
        customerOrg,
        customerOrgMemberId,
      };

      setLinkedQuotations((prev) => {
        if (qt.salesPersonName) {
          setSalesPersons((prevSps) => {
            const existing = new Set(prevSps.map(s => s.name.toLowerCase()));
            const toAdd: { id: string; name: string; isExt: boolean }[] = [];
            if (!existing.has(qt.salesPersonName!.toLowerCase())) {
              const m = members.find(x => (x.name ?? x.email).toLowerCase() === qt.salesPersonName!.toLowerCase());
              toAdd.push({ id: m?.userId ?? `mem-${qt.salesPersonName}`, name: qt.salesPersonName!, isExt: !m });
            }
            (qt.associateSalesPersons ?? []).forEach((a) => {
              if (!existing.has(a.name.toLowerCase())) {
                const m = members.find(x => x.userId === a.id);
                toAdd.push({ id: a.id, name: a.name, isExt: !m });
              }
            });
            return toAdd.length ? [...prevSps, ...toAdd] : prevSps;
          });
        }
        if (prev.length === 0) {
          const snap = qt.customerSnapshot as any;
          const addrLines = [snap?.organizationName, snap?.organizationAddress].filter(Boolean).join("\n");
          if (addrLines) setDeliveryAddress(addrLines);
        }
        return [...prev, linked];
      });

      // Append items from this quotation, tagged with source
      const startRow = items.length;
      // If the quotation title is not "Loose Items", auto-group items without an explicit set under that title
      const qtTitle = qt.title ?? "Loose Items";
      const autoGroup = qtTitle.trim().toLowerCase() !== "loose items";
      const autoGroupId    = autoGroup ? `g-${qt.id}` : "";
      const autoGroupLabel = autoGroup ? qtTitle : "";

      const imported: EditableItem[] = qt.items.map((item, idx) => {
        // If the item already belongs to a named set, preserve it (scoped to avoid cross-quotation ID collisions).
        // Only fall back to the quotation-level auto-group for items that have no set assignment.
        const itemHasGroup = Boolean(item.setGroupId);
        const resolvedGroupId    = itemHasGroup ? `${qt.id}:${item.setGroupId}` : autoGroupId;
        const resolvedGroupLabel = itemHasGroup ? (item.setGroupLabel ?? "") : autoGroupLabel;
        const resolvedSetQty     = itemHasGroup ? (item.setQty ?? "1") : (autoGroup ? "1" : "");
        const base: EditableItem = {
          _key:          uid(),
          _quotationId:  qt.id,
          _quotationNo:  qt.quotationNo,
          included:      true,
          rowNo:         startRow + idx + 1,
          productCode:   item.productCode  ?? "",
          description:   item.description  ?? "",
          qty:           String(item.qty   ?? "1"),
          uom:           item.uom          ?? "",
          unitPrice:     String(item.unitPrice  ?? "0"),
          discountPct:   String(item.discountPct ?? "0"),
          totalPrice:    String(item.totalPrice  ?? "0"),
          lineType:      item.lineType ?? "sell",
          setGroupId:    resolvedGroupId,
          setGroupLabel: resolvedGroupLabel,
          setQty:        resolvedSetQty,
          _descriptionSource: ["quote"],
          _editedBy: null,
          _codeSource: "quote",
          _unitPriceSource: "quote",
          _qtySource: "quote",
        };
        return calcItemTotal(base);
      });

      setItems((prev) => {
        const next = [...prev, ...imported];
        if (!amountOverride) setAmount(sumItems(next));
        return next;
      });

      setShowAddSearch(false);
      if (isFirstQuotation && !amountOverride) setAmount(qt.grandTotal);
    } catch (e: any) {
      toast.error(e.message || "Failed to load quotation");
    } finally {
      setQtLoading(false);
    }
  }

  function removeQuotation(qtId: string) {
    const q = linkedQuotations.find((q) => q.id === qtId);
    setLinkedQuotations((prev) => prev.filter((q) => q.id !== qtId));
    if (!q?.isPreloaded) {
      setItems((prev) => {
        const next = prev.filter((i) => i._quotationId !== qtId);
        if (!amountOverride) setAmount(sumItems(next));
        return next;
      });
    }
    if (linkedQuotations.length <= 1) setShowAddSearch(false);
  }

  // ── Item editing ──────────────────────────────────────────────────────────

  const TOTAL_COLS = 5; // code, description, qty, uom, unit price

  async function handleProductCodeBlur(key: string, code: string, prevCode: string) {
    const trimmed = code.trim();
    if (!trimmed || trimmed.toLowerCase() === prevCode.trim().toLowerCase()) return;
    setItems((prev) => prev.map((i) => i._key === key
      ? { ...i, _codeSource: "user", _editedBy: currentUserName || null } as EditableItem
      : i,
    ));
    const product = await getProductByCode(trimmed);
    if (!product) {
      setItems((prev) => prev.map((i) => i._key === key
        ? { ...i, description: "N/A", _descriptionSource: ["user"], _editedBy: currentUserName || null } as EditableItem
        : i,
      ));
      return;
    }
    if (!product.description) return;
    setItems((prev) => prev.map((i) => i._key === key
      ? { ...i, description: product.description!, uom: product.uom ?? i.uom, _descriptionSource: ["catalog"], _editedBy: null }
      : i,
    ));
  }

  function handleCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    colIdx: number,
  ) {
    const container = tableRef.current;
    if (!container) return;
    function focus(r: number, c: number) {
      const el = container!.querySelector<HTMLInputElement>(`[data-row="${r}"][data-col="${c}"]`);
      el?.focus();
      el?.select();
    }
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      if (colIdx < TOTAL_COLS - 1) focus(rowIdx, colIdx + 1);
      else if (rowIdx < items.length - 1) focus(rowIdx + 1, 0);
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      if (colIdx > 0) focus(rowIdx, colIdx - 1);
      else if (rowIdx > 0) focus(rowIdx - 1, TOTAL_COLS - 1);
    } else if (mod && e.key === "ArrowRight") {
      e.preventDefault();
      if (colIdx < TOTAL_COLS - 1) focus(rowIdx, colIdx + 1);
      else if (rowIdx < items.length - 1) focus(rowIdx + 1, 0);
    } else if (mod && e.key === "ArrowLeft") {
      e.preventDefault();
      if (colIdx > 0) focus(rowIdx, colIdx - 1);
      else if (rowIdx > 0) focus(rowIdx - 1, TOTAL_COLS - 1);
    } else if (mod && e.key === "ArrowDown") {
      e.preventDefault();
      focus(rowIdx + 1, colIdx);
    } else if (mod && e.key === "ArrowUp") {
      e.preventDefault();
      if (rowIdx > 0) focus(rowIdx - 1, colIdx);
    }
  }

  function updateItem(key: string, patch: Partial<EditableItem>) {
    setItems((prev) => {
      const next = prev.map((i) => {
        if (i._key !== key) return i;
        const updated = { ...i, ...patch };
        return ["qty", "unitPrice", "discountPct"].some((k) => k in patch) ? calcItemTotal(updated) : updated;
      });
      if (!amountOverride) setAmount(sumItems(next));
      return next;
    });
  }

  function toggleAll(included: boolean) {
    setItems((prev) => {
      const next = prev.map((i) => ({ ...i, included }));
      if (!amountOverride) setAmount(sumItems(next));
      return next;
    });
  }

  function handleSetLabelChange(key: string, newLabel: string) {
    setItems((prev) => {
      // If newLabel matches an existing group, join it; otherwise create/rename
      const existing = prev.find((x) => x._key !== key && x.setGroupLabel === newLabel && newLabel);
      const gid = existing?.setGroupId || (newLabel ? `g-${newLabel}` : "");
      const next = prev.map((x) =>
        x._key === key
          ? calcItemTotal({ ...x, setGroupLabel: newLabel, setGroupId: gid, setQty: existing?.setQty || x.setQty || "1" })
          : x,
      );
      if (!amountOverride) setAmount(sumItems(next));
      return next;
    });
  }

  function handleSetQtyChange(groupId: string, newQty: string) {
    setItems((prev) => {
      const next = prev.map((x) =>
        x.setGroupId === groupId ? calcItemTotal({ ...x, setQty: newQty }) : x,
      );
      if (!amountOverride) setAmount(sumItems(next));
      return next;
    });
  }

  function handleGroupLabelEdit(groupId: string, newLabel: string) {
    setItems((prev) => {
      const next = prev.map((x) =>
        x.setGroupId === groupId ? { ...x, setGroupLabel: newLabel, setGroupId: newLabel ? `g-${newLabel}` : "" } : x,
      );
      if (!amountOverride) setAmount(sumItems(next));
      return next;
    });
  }

  function removeGroup(groupId: string) {
    setItems((prev) => {
      const next = prev.map((x) =>
        x.setGroupId === groupId
          ? calcItemTotal({ ...x, setGroupId: "", setGroupLabel: "", setQty: "" })
          : x,
      );
      if (!amountOverride) setAmount(sumItems(next));
      return next;
    });
  }

  // ── PDF upload ─────────────────────────────────────────────────────────────

  async function handlePdfSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFile(file);
    setPdfUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/customer-po/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Upload failed (${res.status})`);
      setPdfKey((await res.json()).key);
      toast.success("Document uploaded");
    } catch (e: any) {
      toast.error(e.message || "Failed to upload document");
      setPdfFile(null);
    } finally {
      setPdfUploading(false);
    }
  }

  async function handleCashSale() {
    if (cashSaleLoading) return;
    setCashSaleLoading(true);
    try {
      const no = await getNextCashSaleNo();
      setCustomerPoNo(no);
    } catch {
      toast.error("Failed to generate cash sale number");
    } finally {
      setCashSaleLoading(false);
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!customerPoNo.trim()) { toast.error("Customer PO number is required"); return; }
    if (salesPersons.length === 0) { toast.error("Sales person is required"); return; }
    setSaving(true);
    try {
      const primary = linkedQuotations[0];
      await updateCustomerPo({
        id: cpo.id,
        customerPoNo:    customerPoNo.trim(),
        customerId:      primary?.customerId ?? cpo.customerId ?? undefined,
        customerOrgMemberId: primary?.customerOrgMemberId ?? undefined,
        quotationLinks:  linkedQuotations.length > 0
          ? linkedQuotations.map((q) => ({ quotationId: q.id, quotationNo: q.quotationNo }))
          : undefined,
        items:           items.length > 0
          ? items.filter((i) => i.included).map(({ _key, included, _quotationId, _quotationNo, ...rest }) => ({
              ...rest,
              setGroupId:    rest.setGroupId    || undefined,
              setGroupLabel: rest.setGroupLabel || undefined,
              setQty:        rest.setQty        || undefined,
              _codeSource:         rest._codeSource        || undefined,
              _descriptionSource:  rest._descriptionSource || undefined,
              _unitPriceSource:    rest._unitPriceSource   || undefined,
              _qtySource:          rest._qtySource         || undefined,
              _editedBy:           rest._editedBy          || undefined,
            }))
          : undefined,
        amount,
        currency,
        documentKey:     pdfKey ?? existingDocKey ?? undefined,
        salesPersonName: salesPersons[0]?.name || undefined,
        associateSalesPersons: salesPersons.length > 1 ? salesPersons.slice(1).map(({ id, name }) => ({ id, name })) : undefined,
        notes:           notes || undefined,
        receivedDate:    receivedDate ? new Date(receivedDate) : undefined,
        deliveryDate:    deliveryDate ? new Date(deliveryDate) : undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        status,
      });
      toast.success("Customer PO updated");
      router.push(`/dashboard/sales/customer-po/${cpo.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const computedTotal = sumItems(items);
  const showSearch = isFirstQuotation || showAddSearch;

  // Group items by source quotation for display
  const quotationGroups = linkedQuotations.map((q) => ({
    quotation: q,
    items: items.filter((i) => i._quotationId === q.id),
  }));

  return (
    <div className="p-6">
      <PageHeader
        title="Edit Customer PO"
        description={`Editing ${cpo.customerPoNo}`}
        action={
          <div className="flex items-center gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={cn("h-9 rounded-md border px-3 text-sm font-medium cursor-pointer", STATUS_COLORS[status])}
            >
              <option value="received">Received</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/sales/customer-po/${cpo.id}`)} className="gap-2">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
          </div>
        }
      />

      <div className="space-y-5 w-full">

        {/* ── 1. Quotations (required, multiple) ── */}
        <div className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">
            Our quotation(s) <span className="text-destructive">*</span>
          </h2>

          <div className="space-y-2">

            {/* Linked quotation chips */}
            {linkedQuotations.map((q, idx) => (
              <div key={q.id} className="flex items-center gap-3 px-3 py-2.5 bg-muted/40 rounded-lg border border-border">
                <FileTextIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-sm font-medium">{q.quotationNo}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {parseFloat(q.grandTotal).toLocaleString("en-MY", {
                      style: "currency", currency, minimumFractionDigits: 2,
                    })}
                  </span>
                  {idx === 0 && (
                    <span className="ml-2 text-[10px] text-muted-foreground">(primary)</span>
                  )}
                </div>
                <button onClick={() => removeQuotation(q.id)} className="text-muted-foreground hover:text-foreground shrink-0">
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {/* Customer — auto from first quotation (read-only) */}
            {primaryCustomer && (primaryCustomer.customerName || primaryCustomer.customerOrg) && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30">
                <UserIcon className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  {primaryCustomer.customerName && (
                    <p className="text-sm font-medium leading-none">{primaryCustomer.customerName}</p>
                  )}
                  {primaryCustomer.customerOrg && (
                    <p className="text-[11px] md:text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      <BuildingIcon className="w-3 h-3" /> {primaryCustomer.customerOrg}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Search input — shown for first, or when adding more */}
            {showSearch ? (
              <div className="space-y-1.5">
                <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none z-10" />
                <Input
                  value={qtSearch}
                  onChange={(e) => handleQtSearch(e.target.value)}
                  onKeyDown={handleQtKeyDown}
                  placeholder={isFirstQuotation ? "Search by quotation number…" : "Search another quotation…"}
                  className="pl-9 h-9 text-sm"
                  disabled={qtLoading}
                  autoFocus={isFirstQuotation}
                />
                {qtLoading && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">Loading…</span>
                )}
                {!isFirstQuotation && (
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => { setShowAddSearch(false); setQtSearch(""); setQtResults([]); }}
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                )}
                {qtResults.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                    {qtResults.map((qt, idx) => {
                      const snap = qt.customerSnapshot as any;
                      const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
                      const alreadyLinked = linkedQuotations.some((q) => q.id === qt.id);
                      const diffCustomer = !!(
                        primaryCustomer &&
                        primaryCustomer.customerId !== qt.customerId
                      );
                      const disabled = alreadyLinked || diffCustomer;
                      return (
                        <button
                          key={qt.id}
                          disabled={disabled}
                          className={cn(
                            "w-full text-left px-3 py-2 transition-colors border-b border-border/30 last:border-0",
                            disabled ? "opacity-40 cursor-not-allowed" : idx === qtHighlight ? "bg-muted" : "hover:bg-muted/50",
                          )}
                          onClick={() => !disabled && selectQuotation(qt.id, qt.quotationNo)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-medium">{qt.quotationNo}</span>
                            <span className="text-[10px] font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded px-1.5 py-0.5">
                              Final
                            </span>
                            {alreadyLinked && (
                              <span className="text-[10px] text-muted-foreground">already linked</span>
                            )}
                            {diffCustomer && (
                              <span className="text-[10px] text-destructive">different customer</span>
                            )}
                            {qt.cpoCount > 0 && (
                              <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-1.5 py-0.5">
                                {qt.cpoCount} CPO{qt.cpoCount !== 1 ? "s" : ""}
                              </span>
                            )}
                            {qt.grandTotal && (
                              <span className="text-[11px] md:text-[11px] text-muted-foreground ml-auto tabular-nums">
                                {parseFloat(qt.grandTotal).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                              </span>
                            )}
                          </div>
                          {custName && <div className="text-[11px] md:text-[11px] text-muted-foreground mt-0.5">{custName}</div>}
                        </button>
                      );
                    })}
                  </div>
                )}
                </div>
                <p className="text-[11px] md:text-[11px] text-muted-foreground">
                  Only finalized quotations appear. Customer and items auto-fill on selection.
                </p>
              </div>
            ) : (
              /* Add another quotation button */
              linkedQuotations.length > 0 && (
                <button
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-1"
                  onClick={() => setShowAddSearch(true)}
                >
                  <PlusIcon className="w-3 h-3" /> Add another quotation
                </button>
              )
            )}
          </div>
        </div>

        {/* ── 2. PO details ── */}
        <div className="border border-border rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold">PO details</h2>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Customer PO number <span className="text-destructive">*</span></Label>
              <button
                type="button"
                disabled={cashSaleLoading}
                onClick={handleCashSale}
                className="flex items-center gap-1 text-[11px] md:text-[11px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 border border-dashed border-emerald-400 dark:border-emerald-600 rounded px-2 py-0.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {cashSaleLoading
                  ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                  : <PlusIcon className="w-3 h-3" />}
                Cash Sale
              </button>
            </div>
            <Input
              value={customerPoNo}
              onChange={(e) => setCustomerPoNo(e.target.value)}
              placeholder="e.g. HOSPITAL-PO-2025-001"
              className="h-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount</Label>
              <Input
                type="number" min="0" step="0.01"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setAmountOverride(true); }}
                className="h-9 text-sm tabular-nums"
              />
              {items.length > 0 && amountOverride && (
                <button
                  className="text-[10px] text-primary"
                  onClick={() => { setAmount(computedTotal); setAmountOverride(false); }}
                >
                  Reset to item total ({computedTotal})
                </button>
              )}
              {items.length > 0 && !amountOverride && (
                <p className="text-[10px] text-muted-foreground">Auto-calculated from items</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Currency</Label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option>MYR</option><option>USD</option><option>EUR</option><option>SGD</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date received</Label>
              <input
                type="date"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Due delivery date <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Delivery address <span className="text-destructive">*</span></Label>
              <Textarea
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder={"Organization name\nFull address"}
                rows={2}
                className="text-sm resize-none"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">
                Sales person <span className="text-destructive">*</span>
              </label>
              <div
                className="min-h-9 rounded-md border border-input bg-background px-2 py-1.5 flex flex-wrap gap-1.5 items-center cursor-text focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring transition-colors"
                onClick={() => spInputRef.current?.focus()}
              >
                {salesPersons.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded px-2 py-0.5 shrink-0">
                    {s.name}
                    {s.isExt && <span className="relative -top-0.75 text-[8px] font-bold leading-none">ext</span>}
                    <button type="button" onClick={(e) => { e.stopPropagation(); setSalesPersons(prev => prev.filter(x => x.id !== s.id)); }} className="text-blue-500/60 hover:text-blue-700 ml-0.5">
                      <XIcon className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <select
                  value=""
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const m = members.find((x) => x.userId === e.target.value);
                    if (!m) return;
                    const mName = (m.name ?? m.email).toLowerCase();
                    if (salesPersons.some((s) => s.id === m.userId || s.name.toLowerCase() === mName)) return;
                    setSalesPersons((prev) => [...prev, { id: m.userId, name: m.name ?? m.email, isExt: false }]);
                  }}
                  className="h-6 text-xs bg-transparent border-0 outline-none text-muted-foreground cursor-pointer"
                >
                  <option value="">+ member</option>
                  {members.filter((m) => !salesPersons.some((s) => s.id === m.userId || s.name.toLowerCase() === (m.name ?? m.email).toLowerCase())).map((m) => (
                    <option key={m.userId} value={m.userId}>{m.name?.toLowerCase() ?? m.email}</option>
                  ))}
                </select>
                <input
                  ref={spInputRef}
                  type="text"
                  value={spInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.includes(",")) {
                      const parts = val.split(",");
                      const names = parts.slice(0, -1).map(p => p.trim()).filter(Boolean);
                      const memberNames = new Set(members.map(m => (m.name ?? m.email).toLowerCase()));
                      const blocked = names.filter(n => memberNames.has(n.toLowerCase()));
                      if (blocked.length) {
                        toast.error(`"${blocked.join('", "')}" is a member — select from the member list`);
                        setSpInput(parts[parts.length - 1].trimStart());
                        return;
                      }
                      if (names.length) {
                        const t = Date.now();
                        setSalesPersons(prev => {
                          const existing = new Set(prev.map(s => s.name.toLowerCase()));
                          const unique = names.filter(n => !existing.has(n.toLowerCase()));
                          return unique.length ? [...prev, ...unique.map((name, i) => ({ id: `ext-${t}-${i}`, name, isExt: true }))] : prev;
                        });
                      }
                      setSpInput(parts[parts.length - 1].trimStart());
                    } else {
                      setSpInput(val);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !spInput && salesPersons.length > 0) {
                      setSalesPersons(prev => prev.slice(0, -1));
                      return;
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!spInput.trim()) return;
                      const names = spInput.split(",").map(p => p.trim()).filter(Boolean);
                      const memberNames = new Set(members.map(m => (m.name ?? m.email).toLowerCase()));
                      const blocked = names.filter(n => memberNames.has(n.toLowerCase()));
                      if (blocked.length) {
                        toast.error(`"${blocked.join('", "')}" is a member — select from the member list`);
                        return;
                      }
                      const t = Date.now();
                      setSalesPersons(prev => {
                        const existing = new Set(prev.map(s => s.name.toLowerCase()));
                        const unique = names.filter(n => !existing.has(n.toLowerCase()));
                        return unique.length ? [...prev, ...unique.map((name, i) => ({ id: `ext-${t}-${i}`, name, isExt: true }))] : prev;
                      });
                      setSpInput("");
                    }
                  }}
                  placeholder={salesPersons.length === 0 ? "Type a name… (Enter or , to add)" : ""}
                  className="flex-1 min-w-24 h-6 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── 3. Items (from quotations, editable) ── */}
        {items.length > 0 && (
          <div className="border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Items</h2>
              <span className="text-[11px] md:text-[11px] text-muted-foreground">
                {items.filter((i) => i.included).length} of {items.length} selected · edit qty/price to match customer PO
              </span>
            </div>
            <div className="overflow-x-auto" ref={tableRef}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wider align-bottom">
                    <th className="pb-2 pr-2 w-6">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={items.every((i) => i.included)}
                        ref={(el) => { if (el) el.indeterminate = items.some((i) => i.included) && !items.every((i) => i.included); }}
                        onChange={(e) => toggleAll(e.target.checked)}
                        title="Select all / none"
                      />
                    </th>
                    <th className="text-left pb-2 pr-2 w-6">#</th>
                    <th className="text-left pb-2 pr-2 w-20">Code</th>
                    <th className="text-left pb-2 pr-2">Description</th>
                    <th className="text-right pb-2 pr-2 w-20">Qty</th>
                    <th className="text-right pb-2 pr-2 w-20">Total Qty</th>
                    <th className="text-left pb-2 pr-2 w-12">UOM</th>
                    <th className="text-right pb-2 pr-2 w-24">Unit Price</th>
                    <th className="text-right pb-2 w-24">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows: React.ReactNode[] = [];
                    const seenGroupIds = new Set<string>();
                    let rowIdx = 0;

                    // Build ordered list of group IDs preserving first-appearance order
                    const groupOrder: string[] = [];
                    for (const it of items) {
                      if (it.setGroupId && !seenGroupIds.has(it.setGroupId)) {
                        seenGroupIds.add(it.setGroupId);
                        groupOrder.push(it.setGroupId);
                      }
                    }

                    const renderRow = (item: EditableItem, inSet: boolean) => (
                      <ItemRow
                        key={item._key}
                        item={item}
                        rowIdx={rowIdx++}
                        inSet={inSet}
                        updateItem={updateItem}
                        onSetLabelChange={handleSetLabelChange}
                        onCellKeyDown={handleCellKeyDown}
                        onCodeBlur={handleProductCodeBlur}
                        currentUserName={currentUserName}
                      />
                    );

                    // Quotation source label (only when multiple quotations)
                    const renderQuotationHeader = (qtNo: string) => (
                      <tr key={`qt-${qtNo}`}>
                        <td colSpan={9} className="pt-3 pb-1 text-[10px] font-medium text-muted-foreground">
                          from {qtNo}
                        </td>
                      </tr>
                    );

                    // Render set group header row (editable label, editable qty, removable)
                    const renderGroupHeader = (gid: string) => {
                      const gItems     = items.filter((i) => i.setGroupId === gid && i.included);
                      const first      = items.find((i) => i.setGroupId === gid)!;
                      const groupTotal = gItems.reduce((s, i) => s + (parseFloat(i.totalPrice) || 0), 0);
                      return (
                        <tr key={`hdr-${gid}`} className="bg-blue-50/60 dark:bg-blue-900/10 border-b border-blue-200/60 dark:border-blue-800/40">
                          <td colSpan={5} className="py-1.5 pr-2">
                            <div className="flex items-center gap-2 pl-6">
                              <input
                                value={first.setGroupLabel}
                                onChange={(e) => handleGroupLabelEdit(gid, e.target.value)}
                                className="h-6 flex-1 min-w-0 bg-transparent border border-transparent hover:border-blue-200 focus:border-blue-300 focus:bg-background rounded px-1 text-[13px] md:text-[13px] font-bold text-blue-700 dark:text-blue-300 outline-none transition-colors"
                              />
                              <span className="text-[10px] text-muted-foreground">×</span>
                              <input
                                type="number"
                                min="1"
                                value={first.setQty || "1"}
                                onChange={(e) => handleSetQtyChange(gid, e.target.value)}
                                className="h-6 w-12 border border-blue-200 rounded px-1 text-[10px] bg-background text-right"
                              />
                              <span className="text-[10px] text-muted-foreground">sets</span>
                              <button
                                type="button"
                                onClick={() => removeGroup(gid)}
                                className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                                title="Remove grouping (keeps items)"
                              >
                                <XIcon className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                          <td colSpan={2} className="py-1.5 pr-2 text-right tabular-nums text-[10px] text-muted-foreground">
                            {(() => {
                              const setQty = parseFloat(first.setQty || "1") || 1;
                              return (groupTotal / setQty).toLocaleString("en-MY", { minimumFractionDigits: 2 });
                            })()}
                            <div className="text-[9px] text-muted-foreground/60">/set</div>
                          </td>
                          <td colSpan={2} className="py-1.5 text-right text-[10px] font-semibold text-blue-700 dark:text-blue-300 tabular-nums">
                            {groupTotal.toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    };

                    const renderSpacer = (key: string) => (
                      <tr key={key}><td colSpan={9} className="h-2" /></tr>
                    );
                    const renderLooseHeader = (key: string) => (
                      <tr key={key} className="bg-blue-50/60 dark:bg-blue-900/10 border-b border-blue-200/60 dark:border-blue-800/40">
                        <td colSpan={9} className="py-1.5 pl-7 text-[13px] md:text-[13px] font-bold text-blue-700 dark:text-blue-300">
                          other items
                        </td>
                      </tr>
                    );

                    if (linkedQuotations.length > 1) {
                      // Multi-quotation: show quotation headers, then render with set grouping per quotation
                      for (const group of quotationGroups) {
                        if (group.items.length === 0) continue;
                        rows.push(renderQuotationHeader(group.quotation.quotationNo));

                        const qtGroupIds: string[] = [];
                        const seen = new Set<string>();
                        for (const it of group.items) {
                          if (it.setGroupId && !seen.has(it.setGroupId)) {
                            seen.add(it.setGroupId);
                            qtGroupIds.push(it.setGroupId);
                          }
                        }
                        for (const gid of qtGroupIds) {
                          rows.push(renderGroupHeader(gid));
                          group.items.filter((i) => i.setGroupId === gid).forEach((i) => rows.push(renderRow(i, true)));
                          rows.push(renderSpacer(`sp-${gid}`));
                        }
                        const ungrouped = group.items.filter((i) => !i.setGroupId);
                        if (ungrouped.length > 0) {
                          if (qtGroupIds.length > 0) rows.push(renderLooseHeader(`lh-${group.quotation.quotationNo}`));
                          ungrouped.forEach((i) => rows.push(renderRow(i, false)));
                          rows.push(renderSpacer(`sp-loose-${group.quotation.quotationNo}`));
                        }
                      }
                    } else {
                      // Single quotation: render set groups first, then standalone
                      for (const gid of groupOrder) {
                        rows.push(renderGroupHeader(gid));
                        items.filter((i) => i.setGroupId === gid).forEach((i) => rows.push(renderRow(i, true)));
                        rows.push(renderSpacer(`sp-${gid}`));
                      }
                      const ungrouped = items.filter((i) => !i.setGroupId);
                      if (ungrouped.length > 0) {
                        if (groupOrder.length > 0) rows.push(renderLooseHeader("lh-loose"));
                        ungrouped.forEach((i) => rows.push(renderRow(i, false)));
                      }
                    }

                    return rows;
                  })()}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={8} className="pt-3 pr-2 text-right text-[11px] md:text-[11px] text-muted-foreground font-medium">
                      Total ({items.filter((i) => i.included).length} items)
                    </td>
                    <td className="pt-3 text-right tabular-nums font-bold">
                      {parseFloat(computedTotal).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ── 4. Attach document ── */}
        <div className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">
            Attach document <span className="text-muted-foreground font-normal text-xs">(optional)</span>
          </h2>
          {pdfFile ? (
            <div className="flex items-center gap-2 text-sm">
              <PaperclipIcon className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1 truncate text-[13px]">{pdfFile.name}</span>
              {pdfUploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
              {!pdfUploading && pdfKey && <span className="text-xs text-green-600">Uploaded</span>}
              <button onClick={() => { setPdfFile(null); setPdfKey(undefined); if (pdfRef.current) pdfRef.current.value = ""; }}>
                <XIcon className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          ) : existingDocKey ? (
            <div className="flex items-center gap-2">
              <PaperclipIcon className="w-4 h-4 text-muted-foreground shrink-0" />
              <a href={`/api/customer-po/download/${existingDocKey}`} target="_blank" rel="noopener noreferrer" className="flex-1 text-[13px] text-primary hover:underline truncate">
                {existingDocKey.split("/").pop()?.slice(22) || existingDocKey.split("/").pop()}
              </a>
              <label className="text-xs text-muted-foreground hover:text-foreground cursor-pointer underline shrink-0">
                Replace
                <input ref={pdfRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={handlePdfSelect} />
              </label>
              <button onClick={() => setExistingDocKey(null)}>
                <XIcon className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
              <PaperclipIcon className="w-4 h-4" />
              <span>Attach customer PO (PDF / image)</span>
              <input ref={pdfRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={handlePdfSelect} />
            </label>
          )}
        </div>

        {/* ── 5. Notes ── */}
        <div className="space-y-1.5">
          <Label className="text-xs">Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes…"
            rows={2}
            className="text-sm"
          />
        </div>

        <div className="flex gap-3 pb-8">
          <Button onClick={handleSave} disabled={saving || pdfUploading}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="outline" onClick={() => router.push(`/dashboard/sales/customer-po/${cpo.id}`)}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Shared item row ────────────────────────────────────────────────────────

function ItemRow({
  item,
  rowIdx,
  inSet,
  updateItem,
  onSetLabelChange,
  onCellKeyDown,
  onCodeBlur,
  currentUserName,
}: {
  item: EditableItem;
  rowIdx: number;
  inSet: boolean;
  updateItem: (key: string, patch: Partial<EditableItem>) => void;
  onSetLabelChange: (key: string, newLabel: string) => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => void;
  onCodeBlur: (key: string, code: string, prevCode: string) => void;
  currentUserName: string;
}) {
  const codeOnFocus = useRef("");
  return (
    <tr className={cn(
      "border-b border-border/40 last:border-0 transition-opacity [&>td]:align-top",
      !item.included && "opacity-40",
      inSet && "bg-blue-50/20 dark:bg-blue-900/5",
    )}>
      <td className="py-1.5 pr-2">
        <div className="h-7 flex items-center">
          <input
            type="checkbox"
            className="rounded"
            checked={item.included}
            onChange={(e) => updateItem(item._key, { included: e.target.checked })}
          />
        </div>
      </td>
      <td className="py-1.5 pr-2 text-muted-foreground">
        <div className="h-7 flex items-center">{item.rowNo}</div>
      </td>
      <td className="py-1.5 pr-2">
        <Input
          data-row={rowIdx}
          data-col={0}
          value={item.productCode || ""}
          onChange={(e) => updateItem(item._key, { productCode: e.target.value } as Partial<EditableItem>)}
          onFocus={(e) => { codeOnFocus.current = e.target.value; }}
          onBlur={(e) => onCodeBlur(item._key, e.target.value, codeOnFocus.current)}
          onKeyDown={(e) => onCellKeyDown(e, rowIdx, 0)}
          placeholder="—"
          className="h-7 text-[11px] md:text-[11px] font-mono"
        />
        {item._codeSource === "quote" && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
            <LinkIcon className="w-3 h-3 shrink-0" />from quotation
          </span>
        )}
        {item._codeSource === "user" && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
            <PencilIcon className="w-3 h-3 shrink-0" />
            {currentUserName || "user"} edited CPO
          </span>
        )}
      </td>
      <td className="py-1.5 pr-2">
        <div className="space-y-0.5">
          <Input
            data-row={rowIdx}
            data-col={1}
            value={item.description || ""}
            onChange={(e) => {
              const prev = item._descriptionSource ?? [];
              const next: typeof prev = [...prev.filter(s => s !== "catalog" && s !== "quote" && s !== "user"), "user"];
              updateItem(item._key, { description: e.target.value, _descriptionSource: next, _editedBy: currentUserName || null } as Partial<EditableItem>);
            }}
            onKeyDown={(e) => onCellKeyDown(e, rowIdx, 1)}
            placeholder="—"
            className="h-7 text-[11px] md:text-[11px]"
          />
          {(item._descriptionSource ?? []).includes("quote") && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
              <LinkIcon className="w-3 h-3 shrink-0" />from quotation
            </span>
          )}
          {(item._descriptionSource ?? []).includes("catalog") && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
              <DatabaseIcon className="w-3 h-3 shrink-0" />from product table
            </span>
          )}
          {(item._descriptionSource ?? []).includes("user") && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
              <PencilIcon className="w-3 h-3 shrink-0" />
              {item._editedBy || currentUserName || "user"} edited CPO
            </span>
          )}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground">Set:</span>
            <input
              value={item.setGroupLabel}
              onChange={(e) => onSetLabelChange(item._key, e.target.value)}
              placeholder="(none)"
              className="h-5 w-72 border border-border rounded px-1 text-[9px] bg-background text-muted-foreground"
            />
          </div>
        </div>
      </td>
      <td className="py-1.5 pr-2">
        <div className="space-y-0.5">
          <Input
            data-row={rowIdx}
            data-col={2}
            type="number" min="0" step="any"
            value={item.qty}
            disabled={!item.included}
            onChange={(e) => updateItem(item._key, { qty: e.target.value, _qtySource: "user", _editedBy: currentUserName || null } as Partial<EditableItem>)}
            onKeyDown={(e) => onCellKeyDown(e, rowIdx, 2)}
            className="h-7 text-[11px] md:text-[11px] text-right tabular-nums w-20 ml-auto"
          />
          {inSet && <div className="text-[9px] text-muted-foreground text-right">/set</div>}
          {item._qtySource === "quote" && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
              <LinkIcon className="w-3 h-3 shrink-0" />from quotation
            </span>
          )}
          {item._qtySource === "user" && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
              <PencilIcon className="w-3 h-3 shrink-0" />
              {currentUserName || "user"} edited CPO
            </span>
          )}
        </div>
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums text-[11px] md:text-[11px]">
        <div className="h-7 flex items-center justify-end">
          {item.included ? (() => {
            const q = parseFloat(item.qty || "0") || 0;
            const s = item.setGroupId ? (parseFloat(item.setQty || "1") || 1) : 1;
            return (q * s).toLocaleString("en-MY", { maximumFractionDigits: 4 });
          })() : "—"}
        </div>
      </td>
      <td className="py-1.5 pr-2">
        <Input
          data-row={rowIdx}
          data-col={3}
          value={item.uom || ""}
          onChange={(e) => updateItem(item._key, { uom: e.target.value })}
          onKeyDown={(e) => onCellKeyDown(e, rowIdx, 3)}
          placeholder="unit"
          className="h-7 text-[11px] md:text-[11px] w-16"
        />
      </td>
      <td className="py-1.5 pr-2">
        <Input
          data-row={rowIdx}
          data-col={4}
          type="number" min="0" step="any"
          value={item.unitPrice}
          disabled={!item.included}
          onChange={(e) => updateItem(item._key, { unitPrice: e.target.value, _unitPriceSource: "user", _editedBy: currentUserName || null } as Partial<EditableItem>)}
          onKeyDown={(e) => onCellKeyDown(e, rowIdx, 4)}
          className="h-7 text-[11px] md:text-[11px] text-right tabular-nums w-24 ml-auto"
        />
        {item._unitPriceSource === "quote" && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
            <LinkIcon className="w-3 h-3 shrink-0" />from quotation
          </span>
        )}
        {item._unitPriceSource === "user" && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
            <PencilIcon className="w-3 h-3 shrink-0" />
            {currentUserName || "user"} edited CPO
          </span>
        )}
      </td>
      <td className="py-1.5 text-right tabular-nums font-medium text-[11px] md:text-[11px]">
        <div className="h-7 flex items-center justify-end">
          {item.included
            ? parseFloat(item.totalPrice).toLocaleString("en-MY", { minimumFractionDigits: 2 })
            : "—"}
        </div>
      </td>
    </tr>
  );
}
