"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updateSalesOrder,
  type SalesOrderItemInput,
  type SalesOrderWithItems,
} from "@/server/sales-order";
import { getCustomers } from "@/server/customer";
import {
  getCustomerPoForSoCreate,
  searchCustomerPosByNo,
  type CustomerPoSearchResult,
} from "@/server/customer-purchase-order";
import { searchProductsByDesignCode } from "@/server/inventory";
import { type OrgMember } from "@/server/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import { uid } from "@/lib/uid";
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  SearchIcon,
  XIcon,
  BuildingIcon,
  LinkIcon,
  PencilIcon,
  DatabaseIcon,
  FileTextIcon,
  GripVerticalIcon,
  ChevronDownIcon,
  AlertTriangleIcon,
} from "lucide-react";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];

type LinkedCpo = {
  id: string;
  customerPoNo: string;
  customerId: string | null;
  customerSnapshot: {
    title?: string; name: string; organizationName?: string;
    organizationAddress?: string; email?: string; contactNo?: string;
  } | null;
  deliveryDate: string;
  salesPersonName: string | null;
  deliveryAddress?: string | null;
  _salesPersonInherited?: string | null;
  _deliveryDateInherited?: string | null;
  _deliveryAddressInherited?: string | null;
};

interface LineItem extends SalesOrderItemInput {
  _key: string;
  sourcingType?: "trading" | "oem" | null;
  designBrandName?: string | null;
  designBrandCode?: string | null;
  privateLabelCode?: string | null;
  _designBrandSource?: "catalog" | "user" | null;
  _privateLabelSource?: "auto" | "user" | null;
  sourceCustomerPoId: string;
  sourceCustomerPoNo: string;
  _descriptionSource?: Array<"quote" | "catalog" | "user" | "cpo" | "so"> | null;
  _codeSource?: Array<"cpo" | "quotation" | "user" | "so"> | null;
  _qtySource?: Array<"cpo" | "quotation" | "user" | "so"> | null;
  _uomSource?: string | null;
  _unitPriceSource?: string | null;
  _discountSource?: string | null;
  _editedBy?: string | null;
  _soEditedBy?: string | null;
  _isAdditional?: boolean;
}

const SO_STATUS_MAP: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",             className: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400" },
  submitted: { label: "Awaiting Approval", className: "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400" },
  confirmed: { label: "Confirmed",         className: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400" },
  fulfilled: { label: "Fulfilled",         className: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled",         className: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = SO_STATUS_MAP[status] ?? SO_STATUS_MAP.draft;
  return <span className={`text-[11px] font-medium rounded px-2 py-0.5 ${cfg.className}`}>{cfg.label}</span>;
}

const newLine = (rowNo: number): LineItem => ({
  _key: uid(),
  rowNo,
  productCode: "",
  description: "",
  qty: "1",
  uom: "",
  unitPrice: "0",
  discountPct: "0",
  discountAmt: "0",
  totalPrice: "0",
  lineType: "sell",
  rentalDuration: "",
  rentalUnit: "case",
  sourcingType: null,
  designBrandName: "",
  designBrandCode: "",
  privateLabelCode: "",
  _designBrandSource: null,
  _privateLabelSource: null,
  setGroupId: "",
  setGroupLabel: "",
  setQty: "",
  sourceQuotationId: "",
  sourceCustomerPoId: "",
  sourceCustomerPoNo: "",
  _descriptionSource: null,
  _isAdditional: true,
});

// Autocomplete on the OEM "Design Code" column — searches the catalogue by
// product.designBrandCode (min 3 chars) and, on a match, fills Design Brand
// Name and (if still empty) Description, tagging both with their source.
function DesignCodeCell({
  item,
  onUpdate,
  disabled,
  dataRow,
  dataCol,
  onKeyDown,
  invalid,
  currentUserName,
}: {
  item: LineItem;
  onUpdate: (key: string, patch: Partial<LineItem>) => void;
  disabled?: boolean;
  dataRow?: number;
  dataCol?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  invalid?: boolean;
  currentUserName?: string;
}) {
  const [q, setQ] = useState(item.designBrandCode ?? "");
  const [results, setResults] = useState<{ id: string; productCode: string; description: string | null; brand: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentVal = useRef(item.designBrandCode ?? "");

  useEffect(() => {
    setQ(item.designBrandCode ?? "");
    currentVal.current = item.designBrandCode ?? "";
  }, [item.designBrandCode]);

  // A match always reflects the fetched product — Design Code becomes
  // exactly what the user typed, Design Brand comes from the catalogue's
  // product.brand, Description from product.description (tagged "catalog"
  // so it's clear where the value now comes from). The one thing a match
  // never does is downgrade Brand/Description to empty: if the catalogue
  // has nothing for a spot, keep whatever was already there instead of
  // wiping it.
  function applyMatch(p: { brand: string | null; description: string | null }, typedCode: string) {
    onUpdate(item._key, {
      designBrandCode: typedCode,
      designBrandName: p.brand || item.designBrandName || "",
      _designBrandSource: "catalog",
      description: (p.description || item.description || "").toUpperCase(),
      _descriptionSource: ["catalog"],
    });
  }

  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  function handleInput(val: string) {
    setQ(val);
    currentVal.current = val;
    // Design Code always reflects exactly what the user typed, independent
    // of whether it resolves to a catalogue match — otherwise a non-matching
    // code would silently never reach item state and get lost on save.
    onUpdate(item._key, { designBrandCode: val, _soEditedBy: currentUserName || "user" });
    if (debounce.current) clearTimeout(debounce.current);
    if (val.trim().length < 3) { setResults([]); setOpen(false); setSearched(false); return; }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      const r = await searchProductsByDesignCode(val).finally(() => setSearching(false));
      if (val !== currentVal.current) return;
      setResults(r);
      setSearched(true);
      setOpen(true);
      const exact = r.find((p) => p.productCode.toLowerCase() === val.trim().toLowerCase());
      if (exact) {
        applyMatch(exact, val.trim());
        setOpen(false);
      }
    }, 300);
  }

  return (
    <div className="relative">
      <input
        data-row={dataRow} data-col={dataCol}
        value={q}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => { if (results.length > 0 || searched) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder="search by product code… (required)"
        className={`h-7 w-full text-[11px] border rounded px-1.5 bg-background disabled:opacity-40 disabled:cursor-not-allowed ${invalid ? "border-destructive" : "border-input"}`}
      />
      {open && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-64 rounded-md border border-border bg-background shadow-md max-h-40 overflow-y-auto text-xs">
          {searching && (
            <div className="px-2 py-2 text-muted-foreground">Searching…</div>
          )}
          {!searching && results.length === 0 && searched && (
            <div className="px-2 py-2 text-muted-foreground">No matching product found</div>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-2 py-1.5 hover:bg-accent flex flex-col gap-0.5"
              onClick={() => { applyMatch(p, p.productCode); setQ(p.productCode); setOpen(false); }}
            >
              <span className="font-mono font-medium">{p.productCode}</span>
              <span className="text-muted-foreground truncate">
                {p.brand ? `${p.brand} · ${p.description ?? ""}` : (p.description ?? "")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function calcLine(item: LineItem): LineItem {
  const qty = parseFloat(item.qty || "0") || 0;
  const up = parseFloat(item.unitPrice || "0") || 0;
  const dPct = parseFloat(item.discountPct || "0") || 0;
  const gross = qty * up;
  const dAmt = (gross * dPct) / 100;
  return { ...item, discountAmt: dAmt.toFixed(2), totalPrice: (gross - dAmt).toFixed(2) };
}

function calcTotals(items: LineItem[], sstPct: string, discPct: string) {
  const subtotal = items.reduce((s, i) => s + parseFloat(i.totalPrice || "0"), 0);
  const overallDiscAmt = (subtotal * (parseFloat(discPct) || 0)) / 100;
  const afterDisc = subtotal - overallDiscAmt;
  const sstAmt = (afterDisc * (parseFloat(sstPct) || 0)) / 100;
  return { subtotal, overallDiscAmt, sstAmt, grand: afterDisc + sstAmt };
}

const fmt = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

function toDateInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().split("T")[0];
}

interface Props {
  order: SalesOrderWithItems;
  members: OrgMember[];
  currentUserName: string;
  openCpos?: CustomerPoSearchResult[];
  updateFn?: typeof updateSalesOrder;
  detailHref?: string;
  businessType?: string;
}

export function EditSalesOrderClient({ order, members, currentUserName, openCpos = [], updateFn = updateSalesOrder, detailHref, businessType = "trading" }: Props) {
  const router = useRouter();
  const backHref = detailHref ?? `/dashboard/sales/order/${order.id}`;
  const showSourcing = businessType !== "trading";
  const snap = order.customerSnapshot as any;

  // ── Customer POs ─────────────────────────────────────────────────────────────
  const existingCpoLinks = (order.customerPoLinks as { customerPoId: string; customerPoNo: string; salesPersonName?: string | null; externalPersons?: { id: string; name: string }[] }[] | null) ?? [];
  const [linkedCpos, setLinkedCpos] = useState<LinkedCpo[]>(
    existingCpoLinks.map((l, idx) => {
      const cpoCustomer = order.cpoCustomers.find((cc) => cc.customerPoId === l.customerPoId);
      const spInherited = cpoCustomer?.salesPersonName ?? null;         // CPO original (for badge)
      const spCurrent = l.salesPersonName ?? cpoCustomer?.salesPersonName ?? null; // SO-edited or CPO original
      const dateInherited = cpoCustomer?.deliveryDate
        ? new Date(cpoCustomer.deliveryDate).toISOString().slice(0, 10) : "";
      const addrInherited = cpoCustomer?.customerSnapshot?.organizationAddress ?? null;
      const deliveryAddr = idx === 0 ? (order.deliveryAddress ?? "") : (addrInherited ?? "");
      return {
        id: l.customerPoId,
        customerPoNo: l.customerPoNo,
        customerId: cpoCustomer?.customerId ?? null,
        customerSnapshot: cpoCustomer?.customerSnapshot ?? null,
        deliveryDate: dateInherited,
        salesPersonName: spCurrent,
        deliveryAddress: deliveryAddr,
        _salesPersonInherited: spInherited,
        _deliveryDateInherited: dateInherited,
        _deliveryAddressInherited: addrInherited ?? "",
      };
    }),
  );
  const [cpoSearch, setCpoSearch] = useState("");
  const [cpoResults, setCpoResults] = useState<CustomerPoSearchResult[]>([]);
  const [cpoHighlight, setCpoHighlight] = useState(-1);
  const [cpoLoading, setCpoLoading] = useState(false);
  const [cpoDropdownOpen, setCpoDropdownOpen] = useState(false);
  const cpoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Customer ────────────────────────────────────────────────────────────────
  const initialCustomer: Customer | null = order.customerId && snap
    ? ({
        id: order.customerId,
        title: snap.title ?? null,
        name: snap.name ?? "",
        contactNo: snap.contactNo ?? null,
        email: snap.email ?? null,
        createdAt: new Date(),
        createdByName: null,
        companies: snap.organizationName
          ? [{ id: "__snap__", customerId: order.customerId, organizationName: snap.organizationName, organizationAddress: snap.organizationAddress ?? null, isPrimary: true, createdAt: new Date() }]
          : [],
      } as unknown as Customer)
    : null;

  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(initialCustomer);
  const [custOrgMemberId, setCustOrgMemberId] = useState<string | undefined>(undefined);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const custDropdownRef = useRef<HTMLDivElement>(null);
  const cpoSearchRef = useRef<HTMLDivElement>(null);

  // ── Urgent auth fields ───────────────────────────────────────────────────────
  const isUrgent = order.soType === "urgent";
  const isNonStandard = order.soType !== "standard";
  const [urgentAuthType, setUrgentAuthType] = useState<"verbal" | "email" | "loi" | "internal">(
    ((order as any).urgentAuthType as "verbal" | "email" | "loi" | "internal") ?? "verbal",
  );
  const [urgentAuthBy, setUrgentAuthBy] = useState((order as any).urgentAuthBy ?? "");
  const [urgentAuthDate, setUrgentAuthDate] = useState((order as any).urgentAuthDate ?? "");
  const [urgentPoExpectedBy, setUrgentPoExpectedBy] = useState((order as any).urgentPoExpectedBy ?? "");
  const [urgentAuthNotes, setUrgentAuthNotes] = useState((order as any).urgentAuthNotes ?? "");

  // ── Header ──────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState(order.status ?? "draft");
  const spInputRef = useRef<HTMLInputElement>(null);
  const [spInput, setSpInput] = useState("");
  const [salesPersons, setSalesPersons] = useState<{ id: string; name: string; isExt: boolean }[]>(() => {
    if (existingCpoLinks.length > 0) return [];
    const list: { id: string; name: string; isExt: boolean }[] = [];
    if (order.salesPersonName) {
      const m = members.find(x => (x.name ?? x.email)?.toLowerCase() === order.salesPersonName!.toLowerCase());
      list.push({ id: m?.userId ?? `sp-${order.salesPersonName}`, name: order.salesPersonName, isExt: !m });
    }
    ((order.associateSalesPersons as { id: string; name: string }[] | null) ?? []).forEach((a) => {
      const m = members.find(x => x.userId === a.id);
      list.push({ id: a.id, name: a.name, isExt: !m });
    });
    return list;
  });
  const [cpoSalesPersons, setCpoSalesPersons] = useState<Record<string, { id: string; name: string; isExt: boolean }[]>>(() => {
    const map: Record<string, { id: string; name: string; isExt: boolean }[]> = {};
    existingCpoLinks.forEach((l) => {
      const list: { id: string; name: string; isExt: boolean }[] = [];
      const cpoCustomer = order.cpoCustomers.find((cc) => cc.customerPoId === l.customerPoId);
      const spCurrent = l.salesPersonName ?? cpoCustomer?.salesPersonName ?? null;
      if (spCurrent) {
        const m = members.find(x => (x.name ?? x.email)?.toLowerCase() === spCurrent.toLowerCase());
        list.push({ id: m?.userId ?? `sp-${spCurrent}`, name: spCurrent, isExt: !m });
      }
      (l.externalPersons ?? []).forEach((a) => {
        const m = members.find(x => x.userId === a.id);
        list.push({ id: a.id, name: a.name, isExt: !m });
      });
      map[l.customerPoId] = list;
    });
    return map;
  });
  const [cpoSpInputs, setCpoSpInputs] = useState<Record<string, string>>({});
  const cpoSpInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [deliveryDate, setDeliveryDate] = useState(toDateInput(order.deliveryDate));
  const [deliveryAddress, setDeliveryAddress] = useState(order.deliveryAddress ?? "");
  const [notes, setNotes] = useState(order.notes ?? "");

  // ── Pricing ─────────────────────────────────────────────────────────────────
  const [sstPct, setSstPct] = useState(order.sstPct ?? "0");
  const [overallDiscPct, setOverallDiscPct] = useState(order.overallDiscountPct ?? "0");

  // ── Items ───────────────────────────────────────────────────────────────────
  const [items, setItems] = useState<LineItem[]>(
    order.items.length > 0
      ? order.items.map((i) => ({
          // Stable across server/client — a fresh uid() here would differ
          // between the SSR pass and the client's first render and break
          // hydration (every row's data-key would mismatch).
          _key: i.id,
          rowNo: i.rowNo,
          productCode: i.productCode ?? "",
          description: (i.description ?? "").toUpperCase(),
          qty: String(i.qty ?? "1"),
          uom: i.uom ?? "",
          unitPrice: String(i.unitPrice ?? "0"),
          discountPct: String(i.discountPct ?? "0"),
          discountAmt: String(i.discountAmt ?? "0"),
          totalPrice: String(i.totalPrice ?? "0"),
          lineType: (i as any).lineType ?? "sell",
          rentalDuration: (i as any).rentalDuration ?? "",
          rentalUnit: (i as any).rentalUnit ?? "case",
          sourcingType: (i as any).sourcingType ?? null,
          designBrandName: (i as any).designBrandName ?? "",
          designBrandCode: (i as any).designBrandCode ?? "",
          privateLabelCode: (i as any).privateLabelCode ?? "",
          _designBrandSource: (i as any).designBrandSource ?? null,
          _privateLabelSource: (i as any).privateLabelSource ?? null,
          setGroupId: (i as any).setGroupId ?? "",
          setGroupLabel: (i as any).setGroupLabel ?? "",
          setQty: (i as any).setQty ?? "",
          sourceQuotationId: i.sourceQuotationId ?? "",
          sourceCustomerPoId: (i as any).sourceCustomerPoId ?? "",
          sourceCustomerPoNo: (i as any).sourceCustomerPoNo ?? "",
          _descriptionSource: (() => {
            const s = (i as any).descriptionSource;
            if (!s) return (i as any).sourceCustomerPoId ? ["cpo" as const] : null;
            if (Array.isArray(s)) return s as Array<"quote" | "catalog" | "user" | "cpo" | "so">;
            return [s as "quote" | "catalog" | "user" | "cpo" | "so"];
          })(),
          _codeSource: (() => {
            const s = (i as any).codeSource ?? ((i as any).sourceCustomerPoId ? "cpo" : null);
            if (!s) return null;
            if (Array.isArray(s)) return s as Array<"cpo" | "quotation" | "user" | "so">;
            return [s as "cpo" | "quotation" | "user" | "so"];
          })(),
          _qtySource: (() => {
            const s = (i as any).qtySource ?? ((i as any).sourceCustomerPoId ? "cpo" : null);
            if (!s) return null;
            if (Array.isArray(s)) return s as Array<"cpo" | "quotation" | "user" | "so">;
            return [s as "cpo" | "quotation" | "user" | "so"];
          })(),
          _uomSource: (i as any).uomSource ?? ((i as any).sourceCustomerPoId ? "cpo" : null),
          _unitPriceSource: (i as any).unitPriceSource ?? ((i as any).sourceCustomerPoId ? "cpo" : null),
          _discountSource: (i as any).discountSource ?? ((i as any).sourceCustomerPoId ? "cpo" : null),
          _editedBy: (i as any).editedBy ?? null,
          _soEditedBy: (i as any).soEditedBy ?? null,
          _isAdditional: (i as any).isAdditional === true,
        }))
      : [newLine(1)],
  );

  const [saving, setSaving] = useState(false);
  const [cpoPicker, setCpoPicker] = useState<string | null>(null);
  const [cpoPickerPos, setCpoPickerPos] = useState<{ top: number; left: number } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  const codeOnFocus = useRef<Map<string, string>>(new Map());
  const dragKey        = useRef<string | null>(null);
  const [isDragging, setIsDragging]   = useState(false);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const dragClientY = useRef<number>(0);
  const dragRafId   = useRef<number | null>(null);
  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (custDropdownRef.current && !custDropdownRef.current.contains(e.target as Node)) {
        setCustResults([]);
      }
      if (cpoSearchRef.current && !cpoSearchRef.current.contains(e.target as Node)) {
        setCpoResults([]);
        setCpoDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function getRowKeyAtY(clientY: number): string | null {
    const rows = tableRef.current?.querySelectorAll<HTMLElement>("[data-key]");
    if (!rows) return null;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return row.dataset.key ?? null;
    }
    return null;
  }

  useEffect(() => {
    if (!isDragging) return;
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      dragClientY.current = e.clientY;
      const key = getRowKeyAtY(e.clientY);
      setDragOverKey((prev) => (prev !== key ? key : prev));
      const el = tableRef.current;
      if (el) {
        const ZONE = 80, SPEED = 10;
        const rect = el.getBoundingClientRect();
        const rel  = e.clientY - rect.top;
        if (rel < ZONE && rel >= 0)                              el.scrollTop -= SPEED * (1 - rel / ZONE);
        else if (rel > rect.height - ZONE && rel <= rect.height) el.scrollTop += SPEED * (1 - (rect.height - rel) / ZONE);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const targetKey = getRowKeyAtY(e.clientY);
      if (targetKey && dragKey.current && dragKey.current !== targetKey) {
        const current = itemsRef.current;
        const dragged = current.find((i) => i._key === dragKey.current);
        const target  = current.find((i) => i._key === targetKey);
        if (dragged && !dragged.setGroupId && target?.setGroupId) {
          toast.error("Other items cannot be moved into a set group");
          dragKey.current = null;
          setDragOverKey(null);
          setIsDragging(false);
          if (dragRafId.current !== null) { cancelAnimationFrame(dragRafId.current); dragRafId.current = null; }
          return;
        }
        setItems((prev) => {
          const from = prev.findIndex((i) => i._key === dragKey.current);
          const to   = prev.findIndex((i) => i._key === targetKey);
          if (from < 0 || to < 0) return prev;
          const arr = [...prev];
          arr.splice(to, 0, arr.splice(from, 1)[0]);
          return arr.map((i, n) => ({ ...i, rowNo: n + 1 }));
        });
      }
      dragKey.current = null;
      setDragOverKey(null);
      setIsDragging(false);
      if (dragRafId.current !== null) { cancelAnimationFrame(dragRafId.current); dragRafId.current = null; }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop",     onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop",     onDrop);
    };
  }, [isDragging]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── CPO search ──────────────────────────────────────────────────────────────

  const handleCpoSearch = useCallback((val: string) => {
    setCpoSearch(val);
    setCpoHighlight(-1);
    if (val.length < 2) { setCpoResults([]); return; }
    if (cpoTimer.current) clearTimeout(cpoTimer.current);
    cpoTimer.current = setTimeout(async () => {
      setCpoResults(await searchCustomerPosByNo(val));
      setCpoHighlight(-1);
    }, 300);
  }, []);

  function handleCpoKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!cpoResults.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCpoHighlight((i) => Math.min(i + 1, cpoResults.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCpoHighlight((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter")     { e.preventDefault(); const r = cpoResults[cpoHighlight] ?? cpoResults[0]; if (r) selectCpo(r.id); return; }
    if (e.key === "Escape")    { setCpoResults([]); setCpoHighlight(-1); setCpoDropdownOpen(false); }
  }

  async function selectCpo(cpoId: string) {
    if (linkedCpos.some((c) => c.id === cpoId)) {
      toast.error("This customer PO is already linked");
      setCpoSearch(""); setCpoResults([]);
      return;
    }
    setCpoSearch(""); setCpoResults([]); setCpoLoading(true);
    try {
      const data = await getCustomerPoForSoCreate(cpoId);
      if (!data) return;
      const spInherited = data.salesPersonName ?? null;
      const dateInherited = data.deliveryDate ? new Date(data.deliveryDate).toISOString().slice(0, 10) : "";
      const addrInherited = (data.customerSnapshot as any)?.organizationAddress ?? null;
      setLinkedCpos((prev) => [...prev, {
        id: data.id,
        customerPoNo: data.customerPoNo,
        customerId: data.customerId,
        customerSnapshot: data.customerSnapshot,
        deliveryDate: dateInherited,
        salesPersonName: data.salesPersonName ?? null,
        deliveryAddress: addrInherited ?? "",
        _salesPersonInherited: spInherited,
        _deliveryDateInherited: dateInherited,
        _deliveryAddressInherited: addrInherited ?? "",
      }]);
      const spList: { id: string; name: string; isExt: boolean }[] = [];
      if (data.salesPersonName) {
        const m = members.find(x => (x.name ?? x.email)?.toLowerCase() === data.salesPersonName!.toLowerCase());
        spList.push({ id: m?.userId ?? `sp-${data.salesPersonName}`, name: data.salesPersonName, isExt: !m });
      }
      ((data.associateSalesPersons ?? []) as { id: string; name: string }[]).forEach((a) => {
        const m = members.find(x => x.userId === a.id);
        spList.push({ id: a.id, name: a.name, isExt: !m });
      });
      setCpoSalesPersons((prev) => ({ ...prev, [data.id]: spList }));
      setCpoDropdownOpen(false);
    } catch {
      toast.error("Failed to load customer PO");
    } finally {
      setCpoLoading(false);
    }
  }

  function removeCpo(id: string) {
    setCpoSalesPersons((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setLinkedCpos((prev) => prev.filter((c) => c.id !== id));
  }

  // ── Customer search ─────────────────────────────────────────────────────────

  const handleCustSearch = useCallback((val: string) => {
    setCustSearch(val);
    if (val.length < 2) { setCustResults([]); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      const res = await getCustomers(val);
      setCustResults(res.slice(0, 8));
    }, 300);
  }, []);

  function selectCustomer(c: Customer) {
    setSelectedCustomer(c);
    setCustSearch("");
    setCustResults([]);
    setCustOrgMemberId(undefined);
  }

  // ── Items ───────────────────────────────────────────────────────────────────

  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((prev) =>
      prev.map((i) => {
        if (i._key !== key) return i;
        const updated = { ...i, ...patch };
        return ["qty", "unitPrice", "discountPct"].some((k) => k in patch) ? calcLine(updated) : updated;
      }),
    );
  }

  function addLine() {
    setItems((prev) => [...prev, newLine(prev.length + 1)]);
  }

  function removeLine(key: string) {
    setItems((prev) => prev.filter((i) => i._key !== key).map((i, idx) => ({ ...i, rowNo: idx + 1 })));
  }

  function handleSetLabelChange(key: string, newLabel: string) {
    setItems((prev) => {
      const existing = prev.find((x) => x._key !== key && x.setGroupLabel === newLabel && newLabel);
      const gid = existing?.setGroupId || (newLabel ? `g-${newLabel}` : "");
      return prev.map((x) =>
        x._key === key
          ? calcLine({ ...x, setGroupLabel: newLabel, setGroupId: gid, setQty: existing?.setQty || x.setQty || "1" })
          : x,
      );
    });
  }

  function handleGroupLabelEdit(groupId: string, newLabel: string) {
    setItems((prev) =>
      prev.map((x) =>
        x.setGroupId === groupId ? { ...x, setGroupLabel: newLabel, setGroupId: newLabel ? `g-${newLabel}` : "" } : x,
      ),
    );
  }

  function handleSetQtyChange(groupId: string, newQty: string) {
    setItems((prev) =>
      prev.map((x) => (x.setGroupId === groupId ? { ...x, setQty: newQty } : x)),
    );
  }

  function removeGroup(groupId: string) {
    setItems((prev) =>
      prev.map((x) =>
        x.setGroupId === groupId
          ? calcLine({ ...x, setGroupId: "", setGroupLabel: "", setQty: "" })
          : x,
      ),
    );
  }

  // ── Cell keyboard navigation ────────────────────────────────────────────────

  // Column layout for arrow-key nav. When OEM columns are shown, cols 1-3
  // (Design Brand / Design Code / Emboss Code) only accept focus on rows
  // whose sourcingType is "oem" — disabled on "trading"/unset rows, so
  // navigation must skip over them there instead of landing on a dead cell.
  const firstEditableCol = showSourcing ? 4 : 1;
  const qtyCol = showSourcing ? 5 : 2;
  const COLS = qtyCol + 1;

  function isColEnabled(rowIdx: number, colIdx: number): boolean {
    const it = items[rowIdx];
    if (!it) return false;
    if (showSourcing && colIdx >= 1 && colIdx <= 3) return it.sourcingType === "oem";
    return true;
  }

  function handleCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    colIdx: number,
  ) {
    const isModifier = e.metaKey || e.ctrlKey;

    const focus = (r: number, c: number): boolean => {
      if (r < 0 || r >= items.length || !isColEnabled(r, c)) return false;
      const target = tableRef.current?.querySelector<HTMLInputElement>(
        `[data-row="${r}"][data-col="${c}"]`,
      );
      if (target) { target.focus(); target.select(); return true; }
      return false;
    };
    const focusFirstInRow = (r: number): boolean => {
      for (let c = 1; c < COLS; c++) if (focus(r, c)) return true;
      return false;
    };
    const focusLastInRow = (r: number): boolean => {
      for (let c = COLS - 1; c >= 1; c--) if (focus(r, c)) return true;
      return false;
    };

    switch (e.key) {
      case "ArrowDown":
        if (!isModifier) break;
        e.preventDefault();
        if (!focus(rowIdx + 1, colIdx)) focus(rowIdx + 1, firstEditableCol);
        break;
      case "ArrowUp":
        if (!isModifier) break;
        e.preventDefault();
        if (rowIdx > 0 && !focus(rowIdx - 1, colIdx)) focus(rowIdx - 1, firstEditableCol);
        break;
      case "Enter":
        e.preventDefault();
        if (rowIdx < items.length - 1) {
          if (!focus(rowIdx + 1, colIdx)) focus(rowIdx + 1, firstEditableCol);
        } else {
          addLine();
          setTimeout(() => focus(rowIdx + 1, firstEditableCol), 0);
        }
        break;
      case "ArrowRight": {
        if (!isModifier) break;
        e.preventDefault();
        let moved = false;
        for (let c = colIdx + 1; c < COLS; c++) { if (focus(rowIdx, c)) { moved = true; break; } }
        if (!moved) focusFirstInRow(rowIdx + 1);
        break;
      }
      case "ArrowLeft": {
        if (!isModifier) break;
        e.preventDefault();
        let moved = false;
        for (let c = colIdx - 1; c >= 1; c--) { if (focus(rowIdx, c)) { moved = true; break; } }
        if (!moved && rowIdx > 0) focusLastInRow(rowIdx - 1);
        break;
      }
    }
  }

  // ── Update linked CPO ────────────────────────────────────────────────────────

  function updateLinkedCpo(id: string, patch: Partial<Pick<LinkedCpo, "salesPersonName" | "deliveryDate" | "deliveryAddress">>) {
    setLinkedCpos((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c));
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    const primaryCustomerId =
      selectedCustomer?.id ??
      linkedCpos.find((c) => c.customerId)?.customerId ??
      null;
    if (!primaryCustomerId) { toast.error("Please select a customer"); return; }
    if (!items.some((i) => i.description || i.productCode)) { toast.error("Add at least one item"); return; }
    // Sourcing/OEM fields are not enforced here — editing only ever touches a
    // draft order, and a draft is allowed to stay incomplete until it's
    // actually submitted for approval (from the SO detail page).
    if (linkedCpos.length > 0) {
      for (const cpo of linkedCpos) {
        if (!cpoSalesPersons[cpo.id]?.length) {
          toast.error(`Sales person required for ${cpo.customerPoNo}`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      const { subtotal, overallDiscAmt, sstAmt, grand } = calcTotals(items, sstPct, overallDiscPct);
      const finalDeliveryDate = linkedCpos.length > 0
        ? (() => { const d = linkedCpos[0]?.deliveryDate; return d ? new Date(d) : undefined; })()
        : deliveryDate ? new Date(deliveryDate) : undefined;
      await updateFn({
        id: order.id,
        customerId: primaryCustomerId,
        customerOrgMemberId: selectedCustomer ? custOrgMemberId : undefined,
        customerPoLinks: linkedCpos.length > 0
          ? linkedCpos.map((c) => {
              const sp = cpoSalesPersons[c.id] ?? [];
              return {
                customerPoId: c.id,
                customerPoNo: c.customerPoNo,
                salesPersonName: sp[0]?.name ?? null,
                externalPersons: sp.slice(1).map(({ id, name }) => ({ id, name })),
              };
            })
          : undefined,
        status,
        salesPersonName: linkedCpos.length > 0
          ? (cpoSalesPersons[linkedCpos[0]?.id]?.[0]?.name || undefined)
          : (salesPersons[0]?.name || undefined),
        associateSalesPersons: (() => {
          if (linkedCpos.length > 0) {
            const seen = new Set<string>();
            const all = linkedCpos.flatMap((c) => (cpoSalesPersons[c.id] ?? []).slice(1).map(({ id, name }) => ({ id, name })))
              .filter((a) => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
            return all.length > 0 ? all : undefined;
          }
          return salesPersons.length > 1 ? salesPersons.slice(1).map(({ id, name }) => ({ id, name })) : undefined;
        })(),
        deliveryDate: finalDeliveryDate,
        deliveryAddress: (linkedCpos.length > 0 ? linkedCpos[0]?.deliveryAddress : deliveryAddress) || undefined,
        notes: notes || undefined,
        ...(isUrgent && {
          urgentAuthType,
          urgentAuthBy: urgentAuthBy.trim() || undefined,
          urgentAuthDate: urgentAuthDate || undefined,
          urgentPoExpectedBy: urgentPoExpectedBy || undefined,
          urgentAuthNotes: urgentAuthNotes.trim() || undefined,
        }),
        subtotal: subtotal.toFixed(2),
        overallDiscountPct: overallDiscPct,
        overallDiscountAmt: overallDiscAmt.toFixed(2),
        sstPct,
        sst: sstAmt.toFixed(2),
        grandTotal: grand.toFixed(2),
        items: items.map(({ _key, sourceCustomerPoId, sourceCustomerPoNo, _descriptionSource, _codeSource, _qtySource, _uomSource, _unitPriceSource, _discountSource, _editedBy, _soEditedBy, _isAdditional, _designBrandSource, _privateLabelSource, ...rest }) => ({
          ...rest,
          sourceCustomerPoId: sourceCustomerPoId || undefined,
          sourceCustomerPoNo: sourceCustomerPoNo || undefined,
          descriptionSource: _descriptionSource ?? null,
          codeSource: _codeSource ?? null,
          qtySource: _qtySource ?? null,
          uomSource: _uomSource ?? null,
          unitPriceSource: _unitPriceSource ?? null,
          discountSource: _discountSource ?? null,
          editedBy: _editedBy ?? null,
          soEditedBy: _soEditedBy ?? null,
          isAdditional: _isAdditional ?? false,
          designBrandSource: _designBrandSource ?? null,
          privateLabelSource: _privateLabelSource ?? null,
        })),
      });
      toast.success("Sales order updated");
      router.push(backHref);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const { subtotal, overallDiscAmt, sstAmt, grand } = calcTotals(items, sstPct, overallDiscPct);
  const allCompanies = selectedCustomer?.companies ?? [];
  const showCpoColumn = linkedCpos.length > 1;
  const cpoLinkedCustomers = linkedCpos.length > 0
    ? (() => {
        const seen = new Set<string>();
        return linkedCpos.filter((c) => {
          const key = c.customerId ?? c.customerSnapshot?.organizationName ?? c.customerSnapshot?.name ?? "";
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      })()
    : [];

  return (
    <div className="p-6">
      <PageHeader
        title={order.soNo}
        description="Edit sales order"
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <Button variant="outline" size="sm" onClick={() => router.push(backHref)} className="gap-2">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
          </div>
        }
      />

      <div className="space-y-6">

        {/* ── Urgent authorization ── */}
        {isUrgent && (
          <section className="border border-amber-300 dark:border-amber-700 rounded-xl p-4 bg-amber-50/40 dark:bg-amber-900/10">
            <h2 className="text-sm font-semibold mb-3 text-amber-800 dark:text-amber-300">Urgent authorization</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Authorization channel</Label>
                <div className="flex gap-2 flex-wrap">
                  {(["verbal", "email", "loi", "internal"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setUrgentAuthType(c)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border capitalize transition-colors ${
                        urgentAuthType === c
                          ? "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-400 dark:border-amber-600"
                          : "border-border text-muted-foreground hover:border-foreground/30"
                      }`}
                    >
                      {c === "loi" ? "LOI" : c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Authorization date</Label>
                <input
                  type="date"
                  value={urgentAuthDate}
                  onChange={(e) => setUrgentAuthDate(e.target.value)}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Authorized by (customer contact)</Label>
                <Input
                  value={urgentAuthBy}
                  onChange={(e) => setUrgentAuthBy(e.target.value)}
                  placeholder="Name of person who approved…"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">CPO expected by</Label>
                <input
                  type="date"
                  value={urgentPoExpectedBy}
                  onChange={(e) => setUrgentPoExpectedBy(e.target.value)}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Reference / notes</Label>
                <Input
                  value={urgentAuthNotes}
                  onChange={(e) => setUrgentAuthNotes(e.target.value)}
                  placeholder="e.g. Email from John on 25 Jun re: urgent delivery for Ward 5…"
                  className="h-9 text-sm"
                />
              </div>
            </div>
          </section>
        )}

        {/* ── 1. Linked Customer POs ── */}
        <section className="border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Customer POs</h2>
          </div>

          <div className="relative" ref={cpoSearchRef}>
            {/* Trigger — pills + chevron */}
            <div
              className={`min-h-9 flex flex-wrap gap-1.5 items-center px-3 py-2 rounded-md border cursor-pointer transition-colors ${cpoDropdownOpen ? "border-ring ring-1 ring-ring" : "border-border hover:border-ring/50"}`}
              onClick={() => setCpoDropdownOpen((o) => !o)}
            >
              {linkedCpos.length === 0 && (
                <span className="text-sm text-muted-foreground flex-1 select-none">Select customer POs…</span>
              )}
              {linkedCpos.map((c) => {
                const snap = c.customerSnapshot;
                const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
                const fmtD = (d: string | null | undefined) =>
                  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : null;
                const dateStr = fmtD(c.deliveryDate);
                const addrStr = c.deliveryAddress;
                return (
                  <span key={c.id} className="flex items-start gap-1.5 bg-muted border border-border/60 rounded-md px-2 py-1 text-xs font-mono leading-5 max-w-xs">
                    <span className="flex-1 min-w-0">
                      <span className="font-semibold">{c.customerPoNo}</span>
                      {custName && <span className="text-[10px] text-muted-foreground font-sans ml-1.5 hidden sm:inline">{custName}</span>}
                      {(dateStr || addrStr) && (
                        <span className="flex flex-col gap-0 mt-0.5 font-sans">
                          {dateStr && <span className="text-[10px] text-muted-foreground">Due: {dateStr}</span>}
                          {addrStr && <span className="text-[10px] text-muted-foreground whitespace-pre-line">{addrStr}</span>}
                        </span>
                      )}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0"
                      onClick={(e) => { e.stopPropagation(); removeCpo(c.id); }}
                    >
                      <XIcon className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
              <ChevronDownIcon className={`w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0 transition-transform duration-150 ${cpoDropdownOpen ? "rotate-180" : ""}`} />
            </div>

            {/* Dropdown panel */}
            {cpoDropdownOpen && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                {/* Search */}
                <div className="p-2 border-b border-border/60">
                  <div className="relative">
                    <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      value={cpoSearch}
                      onChange={(e) => handleCpoSearch(e.target.value)}
                      onKeyDown={handleCpoKeyDown}
                      placeholder="Search by PO number…"
                      className="pl-8 h-8 text-sm"
                      autoFocus
                    />
                    {cpoLoading && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">Loading…</span>}
                  </div>
                </div>

                {/* Options list */}
                <div className="max-h-64 overflow-y-auto">
                  {(() => {
                    const rows = cpoSearch.length >= 2
                      ? cpoResults
                      : openCpos.filter((r) => !linkedCpos.some((l) => l.id === r.id));

                    if (rows.length === 0) {
                      return (
                        <p className="px-3 py-5 text-sm text-muted-foreground text-center">
                          {cpoSearch.length >= 2 ? "No results" : openCpos.length > 0 ? "All pending CPOs linked" : "No pending CPOs — search above"}
                        </p>
                      );
                    }

                    return rows.map((r, idx) => {
                      const snap = r.customerSnapshot as any;
                      const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
                      const alreadyLinked = linkedCpos.some((c) => c.id === r.id);
                      return (
                        <button
                          key={r.id}
                          disabled={alreadyLinked}
                          className={`w-full text-left px-3 py-2.5 transition-colors border-b border-border/30 last:border-0 disabled:opacity-40 ${idx === cpoHighlight ? "bg-muted" : "hover:bg-muted/50"}`}
                          onClick={() => { if (!alreadyLinked) selectCpo(r.id); }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-medium">{r.customerPoNo}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              r.status === "received"     ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                              : r.status === "acknowledged" ? "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
                              : r.status === "fulfilled"  ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                              : r.status === "cancelled"  ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                              : "bg-muted text-muted-foreground"}`}>
                              {r.status}
                            </span>
                            {alreadyLinked && <span className="text-[10px] text-muted-foreground">linked</span>}
                            <span className="text-[11px] text-muted-foreground ml-auto tabular-nums shrink-0">
                              {r.currency} {parseFloat(r.amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          {custName && <div className="text-[11px] text-muted-foreground mt-0.5">{custName}</div>}
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── 2. Customer ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">
            Customer{(cpoLinkedCustomers.length > 1) ? "s" : ""}
          </h2>

          {cpoLinkedCustomers.length > 0 ? (
            <div className="divide-y divide-border/40">
              {cpoLinkedCustomers.map((cpo) => {
                const snap = cpo.customerSnapshot;
                const name = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : "—";
                const orgName = snap?.organizationName;
                const cposForThisCustomer = linkedCpos.filter(
                  (c) => c.customerId === cpo.customerId ||
                    (!cpo.customerId && c.customerSnapshot?.name === snap?.name)
                );
                return (
                  <div key={cpo.id} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-medium text-sm">{name}</span>
                      <div className="flex items-center gap-1 flex-wrap">
                        {cposForThisCustomer.map((c) => (
                          <span key={c.id} className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                            {c.customerPoNo}
                          </span>
                        ))}
                      </div>
                    </div>
                    {orgName && (
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                        <BuildingIcon className="w-3 h-3 shrink-0" />{orgName}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : selectedCustomer ? (
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">
                    {[selectedCustomer.title, selectedCustomer.name].filter(Boolean).join(" ")}
                  </span>
                  <button
                    onClick={() => { setSelectedCustomer(null); setCustOrgMemberId(undefined); }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
                {allCompanies.length > 0 && (
                  <div className="mt-2">
                    {allCompanies.length === 1 ? (
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <BuildingIcon className="w-3 h-3" /> {allCompanies[0].organizationName}
                      </p>
                    ) : (
                      <div className="space-y-1 mt-2">
                        <Label className="text-[11px] text-muted-foreground">Select company</Label>
                        <select
                          className="w-full h-8 rounded-md border border-border bg-background px-2.5 text-sm"
                          value={custOrgMemberId ?? ""}
                          onChange={(e) => setCustOrgMemberId(e.target.value || undefined)}
                        >
                          <option value="">Primary / default</option>
                          {allCompanies.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.organizationName}{c.isPrimary ? " (primary)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="relative" ref={custDropdownRef}>
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={custSearch}
                onChange={(e) => handleCustSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setCustResults([]); setCustSearch(""); } }}
                placeholder="Search customer by name..."
                className="pl-9 h-9 text-sm"
              />
              {custResults.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                  {custResults.map((c) => {
                    const co = c.memberships[0];
                    return (
                      <button
                        key={c.id}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0"
                        onClick={() => selectCustomer(c)}
                      >
                        <div className="text-sm font-medium">
                          <Highlight text={[c.title, c.name].filter(Boolean).join(" ")} query={custSearch} />
                        </div>
                        {co?.orgName && (
                          <div className="text-[11px] text-muted-foreground">
                            <Highlight text={co.orgName} query={custSearch} />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── 3. Order details ── */}
        {(() => {
          return (
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Order details</h2>

          <div className="overflow-x-auto mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left pb-2 pr-3 w-32 font-medium">CPO / Type</th>
                  <th className="text-left pb-2 pr-3 font-medium">Sales person</th>
                  <th className="text-left pb-2 pr-3 w-36 font-medium">Due delivery</th>
                  <th className="text-left pb-2 font-medium">Delivery address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {linkedCpos.length === 0 ? (
                  <tr>
                    <td className="py-2 pr-3">
                      <span className="text-[11px] text-muted-foreground italic">Cash sale</span>
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <div
                        className="min-h-9 rounded-md border border-input bg-background px-2 py-1.5 flex flex-wrap gap-1.5 items-center cursor-text focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring transition-colors"
                        onClick={() => spInputRef.current?.focus()}
                      >
                        {salesPersons.map((s) => (
                          <span key={s.id} className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded px-2 py-0.5 shrink-0">
                            {s.name}
                            {s.isExt && <span className="relative -top-0.75 text-[8px] font-bold leading-none">ext</span>}
                            <button type="button" onClick={(e) => { e.stopPropagation(); setSalesPersons((prev) => prev.filter((x) => x.id !== s.id)); }} className="text-blue-500/60 hover:text-blue-700 ml-0.5"><XIcon className="w-3 h-3" /></button>
                          </span>
                        ))}
                        <select value="" onClick={(e) => e.stopPropagation()} onChange={(e) => {
                          const m = members.find((x) => x.userId === e.target.value);
                          if (!m) return;
                          const mName = (m.name ?? m.email).toLowerCase();
                          if (salesPersons.some((s) => s.id === m.userId || s.name.toLowerCase() === mName)) return;
                          setSalesPersons((prev) => [...prev, { id: m.userId, name: m.name ?? m.email, isExt: false }]);
                        }} className="h-6 text-xs bg-transparent border-0 outline-none text-muted-foreground cursor-pointer">
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
                              const toAdd = parts.slice(0, -1).map((p) => p.trim()).filter(Boolean);
                              if (toAdd.length) {
                                const memberNames = new Set(members.map((m) => (m.name ?? m.email).toLowerCase()));
                                const blocked = toAdd.filter((n) => memberNames.has(n.toLowerCase()));
                                if (blocked.length) { toast.error(`"${blocked.join('", "')}" is a member — select from the member list`); }
                                const t = Date.now();
                                setSalesPersons((prev) => {
                                  const existing = new Set(prev.map((s) => s.name.toLowerCase()));
                                  const unique = toAdd.filter((n) => !existing.has(n.toLowerCase()) && !memberNames.has(n.toLowerCase()));
                                  return unique.length ? [...prev, ...unique.map((name, i) => ({ id: `ext-${t}-${i}`, name, isExt: true }))] : prev;
                                });
                              }
                              setSpInput(parts[parts.length - 1].trimStart());
                            } else { setSpInput(val); }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Backspace" && !spInput && salesPersons.length > 0) { setSalesPersons((prev) => prev.slice(0, -1)); return; }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (!spInput.trim()) return;
                              const names = spInput.split(",").map((p) => p.trim()).filter(Boolean);
                              const memberNames = new Set(members.map((m) => (m.name ?? m.email).toLowerCase()));
                              const blocked = names.filter((n) => memberNames.has(n.toLowerCase()));
                              if (blocked.length) { toast.error(`"${blocked.join('", "')}" is a member — select from the member list`); return; }
                              const t = Date.now();
                              setSalesPersons((prev) => {
                                const existing = new Set(prev.map((s) => s.name.toLowerCase()));
                                const unique = names.filter((n) => !existing.has(n.toLowerCase()));
                                return unique.length ? [...prev, ...unique.map((name, i) => ({ id: `ext-${t}-${i}`, name, isExt: true }))] : prev;
                              });
                              setSpInput("");
                            }
                          }}
                          placeholder={salesPersons.length === 0 ? "Type a name… (Enter or , to add)" : ""}
                          className="flex-1 min-w-24 h-6 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                        />
                      </div>
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <input
                        type="date"
                        value={deliveryDate}
                        onChange={(e) => setDeliveryDate(e.target.value)}
                        className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </td>
                    <td className="py-2 align-top">
                      <Textarea
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        placeholder={"Organization name\nFull address"}
                        rows={2}
                        className="text-xs resize-none"
                      />
                    </td>
                  </tr>
                ) : (
                  linkedCpos.map((cpo) => {
                    const spSame = cpo._salesPersonInherited != null && cpo.salesPersonName === cpo._salesPersonInherited;
                    const dateSame = cpo._deliveryDateInherited != null && cpo.deliveryDate === cpo._deliveryDateInherited;
                    const addrSame = cpo._deliveryAddressInherited != null && (cpo.deliveryAddress ?? "") === cpo._deliveryAddressInherited;
                    const tagFrom = <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800"><LinkIcon className="w-2.5 h-2.5 shrink-0" />from CPO</span>;
                    const tagEdited = <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"><PencilIcon className="w-2.5 h-2.5 shrink-0" />{currentUserName || "user"} edit SO</span>;
                    return (
                      <tr key={cpo.id}>
                        <td className="py-2 pr-3 align-top">
                          <span className="font-mono text-[11px] font-semibold">{cpo.customerPoNo}</span>
                        </td>
                        <td className="py-2 pr-3 align-top">
                          <div className="space-y-1">
                            {cpo._salesPersonInherited != null && (spSame ? tagFrom : tagEdited)}
                            <div
                              className="min-h-9 rounded-md border border-input bg-background px-2 py-1.5 flex flex-wrap gap-1.5 items-center cursor-text focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring transition-colors"
                              onClick={() => cpoSpInputRefs.current[cpo.id]?.focus()}
                            >
                              {(cpoSalesPersons[cpo.id] ?? []).map((s) => (
                                <span key={s.id} className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded px-2 py-0.5 shrink-0">
                                  {s.name}
                                  {s.isExt && <span className="relative -top-0.75 text-[8px] font-bold leading-none">ext</span>}
                                  <button type="button" onClick={(e) => { e.stopPropagation(); setCpoSalesPersons((prev) => ({ ...prev, [cpo.id]: (prev[cpo.id] ?? []).filter((x) => x.id !== s.id) })); }} className="text-blue-500/60 hover:text-blue-700 ml-0.5"><XIcon className="w-3 h-3" /></button>
                                </span>
                              ))}
                              <select value="" onClick={(e) => e.stopPropagation()} onChange={(e) => {
                                const m = members.find((x) => x.userId === e.target.value);
                                if (!m) return;
                                const mName = (m.name ?? m.email).toLowerCase();
                                if ((cpoSalesPersons[cpo.id] ?? []).some((s) => s.id === m.userId || s.name.toLowerCase() === mName)) return;
                                setCpoSalesPersons((prev) => ({ ...prev, [cpo.id]: [...(prev[cpo.id] ?? []), { id: m.userId, name: m.name ?? m.email, isExt: false }] }));
                              }} className="h-6 text-xs bg-transparent border-0 outline-none text-muted-foreground cursor-pointer">
                                <option value="">+ member</option>
                                {members.filter((m) => !(cpoSalesPersons[cpo.id] ?? []).some((s) => s.id === m.userId || s.name.toLowerCase() === (m.name ?? m.email).toLowerCase())).map((m) => (
                                  <option key={m.userId} value={m.userId}>{m.name?.toLowerCase() ?? m.email}</option>
                                ))}
                              </select>
                              <input
                                ref={(el) => { cpoSpInputRefs.current[cpo.id] = el; }}
                                type="text"
                                value={cpoSpInputs[cpo.id] ?? ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val.includes(",")) {
                                    const parts = val.split(",");
                                    const toAdd = parts.slice(0, -1).map((p) => p.trim()).filter(Boolean);
                                    if (toAdd.length) {
                                      const memberNames = new Set(members.map((m) => (m.name ?? m.email).toLowerCase()));
                                      const blocked = toAdd.filter((n) => memberNames.has(n.toLowerCase()));
                                      if (blocked.length) { toast.error(`"${blocked.join('", "')}" is a member — select from the member list`); }
                                      const t = Date.now();
                                      setCpoSalesPersons((prev) => {
                                        const cur = prev[cpo.id] ?? [];
                                        const existing = new Set(cur.map((s) => s.name.toLowerCase()));
                                        const unique = toAdd.filter((n) => !existing.has(n.toLowerCase()) && !memberNames.has(n.toLowerCase()));
                                        return unique.length ? { ...prev, [cpo.id]: [...cur, ...unique.map((name, i) => ({ id: `ext-${t}-${i}`, name, isExt: true }))] } : prev;
                                      });
                                    }
                                    setCpoSpInputs((prev) => ({ ...prev, [cpo.id]: parts[parts.length - 1].trimStart() }));
                                  } else { setCpoSpInputs((prev) => ({ ...prev, [cpo.id]: val })); }
                                }}
                                onKeyDown={(e) => {
                                  const cur = cpoSpInputs[cpo.id] ?? "";
                                  if (e.key === "Backspace" && !cur && (cpoSalesPersons[cpo.id] ?? []).length > 0) {
                                    setCpoSalesPersons((prev) => ({ ...prev, [cpo.id]: (prev[cpo.id] ?? []).slice(0, -1) })); return;
                                  }
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    if (!cur.trim()) return;
                                    const names = cur.split(",").map((p) => p.trim()).filter(Boolean);
                                    const memberNames = new Set(members.map((m) => (m.name ?? m.email).toLowerCase()));
                                    const blocked = names.filter((n) => memberNames.has(n.toLowerCase()));
                                    if (blocked.length) { toast.error(`"${blocked.join('", "')}" is a member — select from the member list`); return; }
                                    const t = Date.now();
                                    setCpoSalesPersons((prev) => {
                                      const existing = new Set((prev[cpo.id] ?? []).map((s) => s.name.toLowerCase()));
                                      const unique = names.filter((n) => !existing.has(n.toLowerCase()));
                                      return unique.length ? { ...prev, [cpo.id]: [...(prev[cpo.id] ?? []), ...unique.map((name, i) => ({ id: `ext-${t}-${i}`, name, isExt: true }))] } : prev;
                                    });
                                    setCpoSpInputs((prev) => ({ ...prev, [cpo.id]: "" }));
                                  }
                                }}
                                placeholder={(cpoSalesPersons[cpo.id] ?? []).length === 0 ? "Type a name… (Enter or , to add)" : ""}
                                className="flex-1 min-w-24 h-6 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-2 pr-3 align-top">
                          <div className="space-y-1">
                            {cpo._deliveryDateInherited != null && (dateSame ? tagFrom : tagEdited)}
                            <input
                              type="date"
                              value={cpo.deliveryDate}
                              onChange={(e) => updateLinkedCpo(cpo.id, { deliveryDate: e.target.value })}
                              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>
                        </td>
                        <td className="py-2 align-top">
                          <div className="space-y-1">
                            {cpo._deliveryAddressInherited != null && (addrSame ? tagFrom : tagEdited)}
                            <Textarea
                              value={cpo.deliveryAddress ?? ""}
                              onChange={(e) => updateLinkedCpo(cpo.id, { deliveryAddress: e.target.value || null })}
                              placeholder={"Organization name\nFull address"}
                              rows={2}
                              className="text-xs resize-none"
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes..."
              rows={2}
              className="text-sm"
            />
          </div>
        </section>
          );
        })()}

        {/* ── 4. Items table ── */}
        <section className="border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Items</h2>
          </div>
          <div className="overflow-x-auto overflow-y-auto max-h-[55vh]" ref={tableRef}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border text-muted-foreground tracking-wider">
                  <th className="text-left align-bottom pb-2 pr-2 w-8 uppercase">#</th>
                  <th className="text-left align-bottom pb-2 pr-2 w-24 uppercase">Code</th>
                  {showSourcing && (
                    <>
                      <th className="text-left align-bottom pb-2 pr-2 w-24 uppercase">Design Brand</th>
                      <th className="text-left align-bottom pb-2 pr-2 w-24 uppercase">Design Code</th>
                      <th className="text-left align-bottom pb-2 pr-2 w-24 uppercase">Emboss Code</th>
                    </>
                  )}
                  <th className="text-left align-bottom pb-2 pr-2 uppercase">Description</th>
                  <th className="text-right align-bottom pb-2 pr-2 w-16 uppercase">Qty/Set</th>
                  <th className="text-center align-bottom pb-2 pr-2 w-16 uppercase">Total qty</th>
                  <th className="text-left align-bottom pb-2 pr-2 w-14 uppercase">UOM</th>
                  <th className="text-right align-bottom pb-2 pr-2 w-24 uppercase">Unit price</th>
                  <th className="text-right align-bottom pb-2 pr-2 w-24 uppercase">Total unit price</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const colCount = 9 + (showSourcing ? 3 : 0);
                  const SrcTag = ({ src: rawSrc, item: it }: { src: Array<"cpo" | "quotation" | "user" | "so"> | string | null | undefined; item: LineItem }) => {
                    const src: Array<"cpo" | "quotation" | "user" | "so"> | null = !rawSrc ? null : Array.isArray(rawSrc) ? rawSrc : [rawSrc as "cpo" | "quotation" | "user" | "so"];
                    if (!src?.length) return null;
                    return (
                      <>
                        {src.includes("quotation") && (
                          <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                            <LinkIcon className="w-3 h-3 shrink-0" />from quotation
                          </span>
                        )}
                        {src.includes("cpo") && (
                          <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                            <FileTextIcon className="w-3 h-3 shrink-0" />from CPO
                          </span>
                        )}
                        {src.includes("user") && (
                          <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                            <PencilIcon className="w-3 h-3 shrink-0" />{it._editedBy || currentUserName || "user"} edited CPO
                          </span>
                        )}
                        {src.includes("so") && (
                          <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800">
                            <PencilIcon className="w-3 h-3 shrink-0" />{it._soEditedBy || currentUserName || "user"} edit SO
                          </span>
                        )}
                      </>
                    );
                  };
                  const COLOR_PALETTE = [
                    { hdr: "bg-violet-100/70 dark:bg-violet-900/25", row: "bg-violet-50/40 dark:bg-violet-900/10", border: "border-l-4 border-l-violet-400 dark:border-l-violet-500", text: "text-violet-700 dark:text-violet-300" },
                    { hdr: "bg-indigo-100/70 dark:bg-indigo-900/25", row: "bg-indigo-50/40 dark:bg-indigo-900/10", border: "border-l-4 border-l-indigo-400 dark:border-l-indigo-500", text: "text-indigo-700 dark:text-indigo-300" },
                    { hdr: "bg-rose-100/70 dark:bg-rose-900/25", row: "bg-rose-50/40 dark:bg-rose-900/10", border: "border-l-4 border-l-rose-400 dark:border-l-rose-500", text: "text-rose-700 dark:text-rose-300" },
                    { hdr: "bg-fuchsia-100/70 dark:bg-fuchsia-900/25", row: "bg-fuchsia-50/40 dark:bg-fuchsia-900/10", border: "border-l-4 border-l-fuchsia-400 dark:border-l-fuchsia-500", text: "text-fuchsia-700 dark:text-fuchsia-300" },
                    { hdr: "bg-orange-100/70 dark:bg-orange-900/25", row: "bg-orange-50/40 dark:bg-orange-900/10", border: "border-l-4 border-l-orange-400 dark:border-l-orange-500", text: "text-orange-700 dark:text-orange-300" },
                    { hdr: "bg-teal-100/70 dark:bg-teal-900/25", row: "bg-teal-50/40 dark:bg-teal-900/10", border: "border-l-4 border-l-teal-400 dark:border-l-teal-500", text: "text-teal-700 dark:text-teal-300" },
                  ];
                  const stableColorIdx = (key: string) => {
                    let h = 0;
                    for (let i = 0; i < key.length; i++) { h = Math.imul(31, h) + key.charCodeAt(i) | 0; }
                    return Math.abs(h) % COLOR_PALETTE.length;
                  };
                  // For urgent/proforma SO: palette by first-appearance order of quotation IDs (avoids hash collisions)
                  const urgentQtOrder = isNonStandard ? (() => {
                    const seen: string[] = [];
                    const lqs = (order.linkedQuotations as { id: string }[] | null) ?? [];
                    for (const q of lqs) { if (!seen.includes(q.id)) seen.push(q.id); }
                    for (const it of items) { const qid = (it as any).sourceQuotationId; if (qid && !seen.includes(qid)) seen.push(qid); }
                    return seen;
                  })() : null;
                  const getColor = (it: LineItem) => {
                    if (isNonStandard && urgentQtOrder) {
                      const qtId = (it as any).sourceQuotationId || null;
                      if (!qtId) return null;
                      const idx = urgentQtOrder.indexOf(qtId);
                      return idx >= 0 ? COLOR_PALETTE[idx % COLOR_PALETTE.length] : null;
                    }
                    const key = it.setGroupId || it.sourceCustomerPoId || (it as any).sourceQuotationId;
                    return key ? COLOR_PALETTE[stableColorIdx(key)] : null;
                  };
                  // For urgent/proforma SO: sort by quotation (first-appearance order), then by setGroupId within each quotation
                  const renderItems = isNonStandard ? (() => {
                    const seenQtIds = new Set<string>();
                    const qtOrder: string[] = [];
                    for (const it of items) {
                      const qtId = (it as any).sourceQuotationId || "__none__";
                      if (!seenQtIds.has(qtId)) { seenQtIds.add(qtId); qtOrder.push(qtId); }
                    }
                    return qtOrder.flatMap((qtId) => {
                      const qtItems = items.filter((i) => ((i as any).sourceQuotationId || "__none__") === qtId);
                      const seenGids = new Set<string>();
                      const groupOrder: string[] = [];
                      for (const it of qtItems) {
                        if (it.setGroupId && !seenGids.has(it.setGroupId)) { seenGids.add(it.setGroupId); groupOrder.push(it.setGroupId); }
                      }
                      return [
                        ...groupOrder.flatMap((gid) => qtItems.filter((i) => i.setGroupId === gid)),
                        ...qtItems.filter((i) => !i.setGroupId),
                      ];
                    });
                  })() : items;
                  let lastCpoId: string | undefined = undefined;
                  let lastQtId: string | undefined = undefined;
                  const shownLooseHeaderForCpo = new Set<string>();
                  const orderLinkedQuotations = (order.linkedQuotations as { id: string; quotationNo: string; customerId?: string | null; customerSnapshot?: { title?: string; name: string; organizationName?: string } | null }[] | null) ?? [];
                  return renderItems.flatMap((item, rowIdx) => {
                  const rows: React.JSX.Element[] = [];
                  const color = getColor(item);
                  const sourceCpo = item.sourceCustomerPoId
                    ? linkedCpos.find((c) => c.id === item.sourceCustomerPoId)
                    : undefined;
                  const cpoCustomerName = sourceCpo?.customerSnapshot
                    ? [sourceCpo.customerSnapshot.title, sourceCpo.customerSnapshot.name].filter(Boolean).join(" ")
                    : null;
                  // Urgent/proforma SO: customer/org section header when linked quotation changes
                  if (isNonStandard && item.sourceQuotationId !== lastQtId) {
                    lastQtId = item.sourceQuotationId;
                    const qt = orderLinkedQuotations.find((q) => q.id === item.sourceQuotationId);
                    const snap = qt?.customerSnapshot;
                    if (snap) {
                      const custDisplayName = [snap.title, snap.name].filter(Boolean).join(" ");
                      const orgName = (snap as any).organizationName ?? null;
                      const matchingCpo = linkedCpos.find((cpo) =>
                        qt && (
                          (qt.customerId && cpo.customerId === qt.customerId) ||
                          (!qt.customerId && qt.customerSnapshot?.name && cpo.customerSnapshot?.name === qt.customerSnapshot?.name)
                        )
                      );
                      rows.push(
                        <tr key={`qt-section-${item.sourceQuotationId ?? "none"}-${rowIdx}`}>
                          <td colSpan={colCount} className={rowIdx === 0 ? "pb-1" : "pt-4 pb-1"}>
                            <div className={`flex items-center gap-2 ${rowIdx > 0 ? "border-t border-border/60 pt-2" : ""}`}>
                              {matchingCpo ? (
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md font-mono ${color?.text ?? "text-muted-foreground"} ${color?.hdr ?? "bg-muted/50"} border border-current/20`}>
                                  {matchingCpo.customerPoNo}
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md font-mono text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800">{isUrgent ? "CPO To Follow" : "Pro-forma"}</span>
                              )}
                              <span className="text-[10px] font-semibold text-foreground">{custDisplayName}</span>
                              {orgName && <span className="text-[10px] text-muted-foreground">{orgName}</span>}
                            </div>
                          </td>
                        </tr>,
                      );
                    }
                  }
                  if (linkedCpos.length > 1 && item.sourceCustomerPoId !== lastCpoId) {
                    lastCpoId = item.sourceCustomerPoId;
                    const cpo = item.sourceCustomerPoId ? linkedCpos.find((c) => c.id === item.sourceCustomerPoId) : undefined;
                    const cpoCustomer = cpo?.customerSnapshot ? [cpo.customerSnapshot.title, cpo.customerSnapshot.name].filter(Boolean).join(" ") : null;
                    const cpoCustomerOrg = cpo?.customerSnapshot?.organizationName ?? null;
                    rows.push(
                      <tr key={`cpo-section-${item.sourceCustomerPoId ?? "none"}-${rowIdx}`}>
                        <td colSpan={colCount} className={rowIdx === 0 ? "pb-1" : "pt-4 pb-1"}>
                          <div className={`flex items-center gap-2 ${rowIdx > 0 ? "border-t border-border/60 pt-2" : ""}`}>
                            {cpo ? (
                              <>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md font-mono ${color?.text ?? "text-muted-foreground"} ${color?.hdr ?? "bg-muted/50"} border border-current/20`}>
                                  {cpo.customerPoNo}
                                </span>
                                {cpoCustomer && <span className="text-[10px] text-muted-foreground">{cpoCustomer}</span>}
                                {cpoCustomerOrg && <span className="text-[10px] text-muted-foreground">{cpoCustomerOrg}</span>}
                              </>
                            ) : (
                              <span className="text-[10px] text-muted-foreground italic">No CPO</span>
                            )}
                          </div>
                        </td>
                      </tr>,
                    );
                  }
                  if (!item.setGroupId) {
                    const cpoKey = isNonStandard
                      ? (item.sourceQuotationId ?? "__global__")
                      : (item.sourceCustomerPoId ?? "__global__");
                    const sectionHasGroups = isNonStandard
                      ? renderItems.some((i) => i.setGroupId && (i.sourceQuotationId ?? "__none__") === (item.sourceQuotationId ?? "__none__"))
                      : renderItems.some((i) => i.setGroupId && (linkedCpos.length > 1 ? i.sourceCustomerPoId === item.sourceCustomerPoId : true));
                    if (sectionHasGroups && !shownLooseHeaderForCpo.has(cpoKey)) {
                      shownLooseHeaderForCpo.add(cpoKey);
                      rows.push(
                        <tr key={`loose-hdr-${cpoKey}`} className="bg-muted/40 border-b border-border/40">
                          <td colSpan={colCount} className="px-2 py-1.5">
                            <span className="text-[11px] font-bold tracking-tight text-muted-foreground">other items</span>
                          </td>
                        </tr>,
                      );
                    }
                  }
                  if (item.setGroupId && renderItems.findIndex((i) => i.setGroupId === item.setGroupId) === rowIdx) {
                    const groupItems = items.filter((i) => i.setGroupId === item.setGroupId);
                    const setQtyNum = parseFloat((item as any).setQty || "1") || 1;
                    const perSetTotal = groupItems.reduce((s, i) => s + parseFloat(i.totalPrice ?? "0"), 0);
                    const groupTotal = perSetTotal * setQtyNum;
                    const perSetPrice = perSetTotal / setQtyNum;
                    rows.push(
                      <tr key={`grp-${item.setGroupId}`} className={`${color?.hdr ?? "bg-muted/40"} border-b border-border/40`}>
                        <td colSpan={colCount} className={`px-2 py-1.5 ${color?.border ?? ""}`}>
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-bold tracking-tight ${color?.text ?? "text-foreground"}`}>{(item as any).setGroupLabel || "Set"}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${color?.text ?? "text-muted-foreground"} border-current/30 bg-white/40 dark:bg-black/20`}>
                              × {(item as any).setQty || "1"} sets
                            </span>
                            {perSetTotal > 0 && (
                              <>
                                <span className={`text-[10px] tabular-nums ${color?.text ?? "text-muted-foreground"}`}>1 set: {fmt(perSetPrice)}</span>
                                <span className={`ml-auto text-[11px] font-semibold ${color?.text ?? "text-foreground"} tabular-nums`}>{fmt(groupTotal)}</span>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>,
                    );
                  }
                  rows.push(
                  <tr
                    key={item._key}
                    data-key={item._key}
                    className={`border-b border-border/50 last:border-0 ${isDragging ? "" : "transition-colors"} ${dragOverKey === item._key ? "border-t-2 border-t-primary" : ""} ${color ? color.row : "bg-background"} ${isDragging && dragKey.current === item._key ? "outline-2 outline-primary/40 -outline-offset-1" : ""} ${item._isAdditional ? "text-red-500 dark:text-red-400" : ""}`}
                  >
                    <td className={`py-1.5 pr-2 align-top ${item._isAdditional ? "text-red-500 dark:text-red-400" : "text-muted-foreground"} ${color?.border ?? ""}`}><div className="h-7 flex items-center">{item.rowNo}</div></td>
                    <td className="py-1.5 pr-2 align-top">
                      <div className="h-7 flex items-center text-[11px] font-mono">{item.productCode || "—"}</div>
                      <SrcTag src={item._codeSource} item={item} />
                      {showSourcing && item.productCode?.trim() && (
                        item.sourcingType ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (item.sourcingType === "trading") {
                                updateItem(item._key, {
                                  sourcingType: "oem",
                                  privateLabelCode: item.privateLabelCode?.trim() ? item.privateLabelCode : (item.productCode ?? ""),
                                  _privateLabelSource: item.privateLabelCode?.trim() ? item._privateLabelSource : "auto",
                                });
                              } else {
                                // Emboss Code is OEM-only — clear it going back to Trading so
                                // a re-toggle to OEM later re-triggers the auto-fill from Code
                                // instead of resurrecting a stale value.
                                updateItem(item._key, { sourcingType: "trading", privateLabelCode: "", _privateLabelSource: null });
                              }
                            }}
                            className={`mt-0.5 block text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${
                              item.sourcingType === "oem"
                                ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800"
                                : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800"
                            }`}
                            title="Click to switch"
                          >
                            {item.sourcingType === "oem" ? "OEM" : "Trading"}
                          </button>
                        ) : (
                          <div className="mt-0.5 flex items-center gap-1">
                            <span className="text-[9px] text-destructive">sourcing?</span>
                            <button
                              type="button"
                              onClick={() => updateItem(item._key, { sourcingType: "trading" })}
                              className="text-[10px] px-1.5 py-0.5 rounded-md border border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                            >
                              Trading
                            </button>
                            <button
                              type="button"
                              onClick={() => updateItem(item._key, {
                                sourcingType: "oem",
                                privateLabelCode: item.privateLabelCode?.trim() ? item.privateLabelCode : (item.productCode ?? ""),
                                _privateLabelSource: item.privateLabelCode?.trim() ? item._privateLabelSource : "auto",
                              })}
                              className="text-[10px] px-1.5 py-0.5 rounded-md border border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                            >
                              OEM
                            </button>
                          </div>
                        )
                      )}
                    </td>
                    {showSourcing && (
                      <>
                        <td className="py-1.5 pr-2 align-top">
                          <input
                            data-row={rowIdx} data-col={1}
                            value={item.designBrandName ?? ""}
                            onChange={(e) => updateItem(item._key, { designBrandName: e.target.value, _designBrandSource: "user", _soEditedBy: currentUserName || "user" })}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 1)}
                            disabled={item.sourcingType !== "oem"}
                            placeholder={item.sourcingType === "oem" ? "e.g. geister (required)" : "—"}
                            className={`h-7 w-full text-[11px] border rounded px-1.5 bg-background disabled:opacity-40 disabled:cursor-not-allowed ${item.sourcingType === "oem" && !item.designBrandName?.trim() ? "border-destructive" : "border-input"}`}
                          />
                          {item.sourcingType === "oem" && item._designBrandSource && (
                            <span
                              className={`inline-flex items-center gap-1 mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md border ${
                                item._designBrandSource === "catalog"
                                  ? "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800"
                                  : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
                              }`}
                            >
                              {item._designBrandSource === "catalog" ? (
                                <><DatabaseIcon className="w-2.5 h-2.5 shrink-0" />from catalogue</>
                              ) : (
                                <><PencilIcon className="w-2.5 h-2.5 shrink-0" />{currentUserName || "user"} edit SO</>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 align-top">
                          <DesignCodeCell
                            item={item}
                            onUpdate={updateItem}
                            disabled={item.sourcingType !== "oem"}
                            dataRow={rowIdx}
                            dataCol={2}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 2)}
                            invalid={item.sourcingType === "oem" && !item.designBrandCode?.trim()}
                            currentUserName={currentUserName}
                          />
                          {item.sourcingType === "oem" && item.designBrandCode?.trim() && (
                            <span className="inline-flex items-center gap-1 mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                              <PencilIcon className="w-2.5 h-2.5 shrink-0" />{currentUserName || "user"} edit SO
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 align-top">
                          <input
                            data-row={rowIdx} data-col={3}
                            value={item.privateLabelCode ?? ""}
                            onChange={(e) => updateItem(item._key, { privateLabelCode: e.target.value, _privateLabelSource: "user", _soEditedBy: currentUserName || "user" })}
                            onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 3)}
                            disabled={item.sourcingType !== "oem"}
                            placeholder={item.sourcingType === "oem" ? "e.g. F680-18DP (required)" : "—"}
                            className={`h-7 w-full text-[11px] border rounded px-1.5 bg-background disabled:opacity-40 disabled:cursor-not-allowed ${item.sourcingType === "oem" && !item.privateLabelCode?.trim() ? "border-destructive" : "border-input"}`}
                          />
                          {item.sourcingType === "oem" && (
                            !item.privateLabelCode?.trim() ? (
                              <span className="inline-flex items-center gap-1 mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md border bg-red-50 text-red-600 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                                <AlertTriangleIcon className="w-2.5 h-2.5 shrink-0" />missing
                              </span>
                            ) : item._privateLabelSource ? (
                              <span
                                className={`inline-flex items-center gap-1 mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md border ${
                                  item._privateLabelSource === "auto"
                                    ? "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800"
                                    : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
                                }`}
                              >
                                {item._privateLabelSource === "auto" ? (
                                  <><LinkIcon className="w-2.5 h-2.5 shrink-0" />from Code</>
                                ) : (
                                  <><PencilIcon className="w-2.5 h-2.5 shrink-0" />{currentUserName || "user"} edit SO</>
                                )}
                              </span>
                            ) : null
                          )}
                        </td>
                      </>
                    )}
                    <td className="py-1.5 pr-2 align-top">
                      <Input data-row={rowIdx} data-col={firstEditableCol} value={item.description ?? ""} onChange={(e) => updateItem(item._key, {
                        description: e.target.value.toUpperCase(),
                        _descriptionSource: [...new Set([...(item._descriptionSource ?? []).filter(s => s !== "quote" && s !== "catalog"), "so"])] as Array<"quote" | "catalog" | "user" | "cpo" | "so">,
                        _soEditedBy: currentUserName || "user",
                      })} onKeyDown={(e) => handleCellKeyDown(e, rowIdx, firstEditableCol)} className="h-7 text-[11px] md:text-[11px]" />
                      {item._isAdditional && (
                        <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                          <PlusIcon className="w-3 h-3 shrink-0" />additional row
                        </span>
                      )}
                      {(item._descriptionSource ?? []).includes("quote") && (
                        <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                          <LinkIcon className="w-3 h-3 shrink-0" />from quotation
                        </span>
                      )}
                      {(item._descriptionSource ?? []).includes("cpo") && (
                        <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                          <FileTextIcon className="w-3 h-3 shrink-0" />from CPO
                        </span>
                      )}
                      {(item._descriptionSource ?? []).includes("catalog") && (
                        <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                          <DatabaseIcon className="w-3 h-3 shrink-0" />from product table
                        </span>
                      )}
                      {(item._descriptionSource ?? []).includes("user") && (
                        <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                          <PencilIcon className="w-3 h-3 shrink-0" />{item._editedBy || currentUserName || "user"} edited CPO
                        </span>
                      )}
                      {(item._descriptionSource ?? []).includes("so") && (
                        <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800">
                          <PencilIcon className="w-3 h-3 shrink-0" />{item._soEditedBy || currentUserName || "user"} edit SO
                        </span>
                      )}
                      {isNonStandard && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[9px] text-muted-foreground">Set:</span>
                          <input
                            value={(item as any).setGroupLabel || ""}
                            onChange={(e) => handleSetLabelChange(item._key, e.target.value)}
                            placeholder="(none)"
                            className="h-5 w-36 border border-border rounded px-1 text-[9px] bg-background text-muted-foreground"
                          />
                        </div>
                      )}
                      {linkedCpos.length > 0 && (
                        <div className="mt-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              if (cpoPicker === item._key) {
                                setCpoPicker(null);
                                setCpoPickerPos(null);
                              } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setCpoPickerPos({ top: rect.bottom + 4, left: rect.left });
                                setCpoPicker(item._key);
                              }
                            }}
                            className={`text-[9px] px-1 py-0.5 rounded border font-mono leading-tight break-all line-clamp-2 transition-colors ${
                              item.sourceCustomerPoId
                                ? "text-blue-700 border-blue-200 bg-blue-50 dark:text-blue-300 dark:border-blue-800 dark:bg-blue-950/40"
                                : "text-muted-foreground border-dashed border-border/60 hover:border-border hover:bg-muted/50"
                            }`}
                          >
                            {item.sourceCustomerPoNo || "— assign CPO"}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 align-top">
                      <Input data-row={rowIdx} data-col={qtyCol} value={item.qty} onChange={(e) => updateItem(item._key, {
                        qty: e.target.value,
                        _qtySource: [...new Set([...(item._qtySource ?? []).filter(s => s !== "quotation"), "so" as const])],
                        _soEditedBy: currentUserName || "user",
                      })} onKeyDown={(e) => handleCellKeyDown(e, rowIdx, qtyCol)} className="h-7 text-[11px] md:text-[11px] text-right tabular-nums" />
                      <SrcTag src={item._qtySource} item={item} />
                    </td>
                    <td className="py-1.5 pr-2 align-top">
                      <div className={`h-7 flex items-center justify-center font-mono tabular-nums text-[11px] ${item._isAdditional ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>
                        {(() => { const s = parseFloat((item as any).setQty || "0") || 1; const q = parseFloat(item.qty || "0"); return s > 1 ? (q * s).toLocaleString("en-MY") : q.toLocaleString("en-MY"); })()}
                      </div>
                    </td>
                    <td className="py-1.5 pr-2 align-top">
                      <div className={`h-7 flex items-center text-[11px] px-1 ${item._isAdditional ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>{item.uom || "—"}</div>
                    </td>
                    <td className="py-1.5 pr-2 align-top">
                      <div className={`h-7 flex items-center justify-end text-[11px] font-mono tabular-nums px-1 ${item._isAdditional ? "text-red-500 dark:text-red-400" : "text-foreground"}`}>{fmt(parseFloat(item.unitPrice ?? "0"))}</div>
                      <SrcTag src={item._unitPriceSource} item={item} />
                    </td>
                    <td className="py-1.5 pr-2 align-top">
                      <div className={`h-7 flex items-center justify-end font-mono tabular-nums text-[11px] ${item._isAdditional ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>
                        {(() => { const s = parseFloat((item as any).setQty || "0") || 1; const q = parseFloat(item.qty || "0"); const u = parseFloat(item.unitPrice || "0"); return fmt(q * s * u); })()}
                      </div>
                    </td>
                    <td className="py-1.5 align-top">
                      <div className="flex items-center gap-1.5">
                        <span
                          draggable
                          onDragStart={(e) => { dragKey.current = item._key; e.dataTransfer.effectAllowed = "move"; setIsDragging(true); }}
                          onDragEnd={() => { dragKey.current = null; setDragOverKey(null); setIsDragging(false); if (dragRafId.current !== null) { cancelAnimationFrame(dragRafId.current); dragRafId.current = null; } }}
                          className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                        >
                          <GripVerticalIcon className="w-3.5 h-3.5 shrink-0" />
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLine(item._key)}
                          disabled={items.length === 1}
                          className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                  return rows;
                  });
                })()}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={() => {
              const newRowIdx = items.length;
              addLine();
              setTimeout(() => {
                const target = tableRef.current?.querySelector<HTMLInputElement>(`[data-row="${newRowIdx}"][data-col="${firstEditableCol}"]`);
                if (target) { target.focus(); target.select(); }
              }, 0);
            }}
            className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" /> Add row
          </button>
        </section>

        {/* ── 5. Pricing summary ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Pricing</h2>
          <div className="flex justify-end">
            <div className="w-72 space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums font-mono">{fmt(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground shrink-0">Overall disc.</span>
                <div className="flex items-center gap-1">
                  <Input value={overallDiscPct} onChange={(e) => setOverallDiscPct(e.target.value)} className="h-7 w-16 text-xs text-right" />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
                <span className="tabular-nums font-mono text-muted-foreground">−{fmt(overallDiscAmt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground shrink-0">SST</span>
                <div className="flex items-center gap-1">
                  <Input value={sstPct} onChange={(e) => setSstPct(e.target.value)} className="h-7 w-16 text-xs text-right" />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
                <span className="tabular-nums font-mono text-muted-foreground">{fmt(sstAmt)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t border-border pt-2">
                <span>Grand total</span>
                <span className="tabular-nums font-mono">{fmt(grand)}</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Actions ── */}
        <div className="flex gap-3 pb-8">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="outline" onClick={() => router.push(backHref)}>
            Cancel
          </Button>
        </div>
      </div>

      {/* ── CPO row picker (fixed portal, not clipped by table overflow) ── */}
      {cpoPicker && cpoPickerPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setCpoPicker(null); setCpoPickerPos(null); }} />
          <div
            className="fixed z-50 rounded-md border border-border bg-background shadow-lg text-xs max-h-64 overflow-y-auto min-w-52"
            style={{ top: cpoPickerPos.top, left: cpoPickerPos.left }}
          >
            <button
              type="button"
              onClick={() => {
                const key = cpoPicker;
                updateItem(key, { sourceCustomerPoId: "", sourceCustomerPoNo: "" });
                setCpoPicker(null); setCpoPickerPos(null);
              }}
              className="w-full text-left px-3 py-2 hover:bg-accent text-muted-foreground border-b border-border/50"
            >
              — No CPO
            </button>
            {linkedCpos.map(cpo => {
              const snap = cpo.customerSnapshot;
              const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
              const current = items.find(i => i._key === cpoPicker);
              const isSelected = current?.sourceCustomerPoId === cpo.id;
              return (
                <button
                  key={cpo.id}
                  type="button"
                  onClick={() => {
                    const key = cpoPicker;
                    updateItem(key, { sourceCustomerPoId: cpo.id, sourceCustomerPoNo: cpo.customerPoNo });
                    setCpoPicker(null); setCpoPickerPos(null);
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-accent border-b border-border/30 last:border-0 ${isSelected ? "bg-blue-50/60 dark:bg-blue-950/20" : ""}`}
                >
                  <span className={`font-mono font-medium ${isSelected ? "text-blue-700 dark:text-blue-300" : ""}`}>{cpo.customerPoNo}</span>
                  {custName && <div className="text-[10px] text-muted-foreground mt-0.5">{custName}</div>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
