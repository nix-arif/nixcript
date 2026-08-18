"use client";

import { useState, useRef, useCallback, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createSalesOrder,
  submitSalesOrder,
  searchConfirmedSalesOrders,
  type SalesOrderItemInput,
} from "@/server/sales-order";
import { searchProducts, getProductsByCode } from "@/server/inventory";
import { getProductByCode } from "@/server/products";
import { getCustomers, getCustomer } from "@/server/customer";
import {
  searchQuotationsByNo,
  getQuotationForSO,
  type QuotationForSO,
} from "@/server/quotation";
import {
  getCustomerPoForSoCreate,
  searchCustomerPosByNo,
  type CustomerPoSearchResult,
} from "@/server/customer-purchase-order";
import { type OrgMember } from "@/server/members";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { Highlight } from "@/components/highlight";
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  SearchIcon,
  XIcon,
  BuildingIcon,
  FileTextIcon,
  LinkIcon,
  PencilIcon,
  DatabaseIcon,
  ChevronDownIcon,
  GripVerticalIcon,
} from "lucide-react";
import type { CustomerPoForSoCreate } from "@/server/customer-purchase-order";
import { uid } from "@/lib/uid";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];

type LinkedQuotation = {
  id: string;
  quotationNo: string;
  customerId?: string | null;
  customerSnapshot?: {
    title?: string;
    name: string;
    organizationName?: string;
    organizationAddress?: string;
  } | null;
  salesPersonName?: string | null;
  deliveryDate?: string | null;
  deliveryAddress?: string | null;
  _fromCpoId?: string; // auto-linked from a CPO
};

type LinkedCpo = {
  id: string;
  customerPoNo: string;
  customerId: string | null;
  customerSnapshot: {
    title?: string; name: string; organizationName?: string;
    organizationAddress?: string; email?: string; contactNo?: string;
  } | null;
  salesPersonName?: string | null;
  deliveryDate?: Date | string | null;
  deliveryAddress?: string | null;
  // tracks original inherited values for source tagging
  _salesPersonInherited?: string | null;
  _deliveryDateInherited?: string | null;
  _deliveryAddressInherited?: string | null;
};

interface LineItem extends SalesOrderItemInput {
  _key: string;
  lineType: "sell" | "rent";
  rentalDuration: string;
  rentalUnit: string;
  sourcingType?: "trading" | "oem" | null;
  setGroupId: string;
  setGroupLabel: string;
  setQty: string;
  sourceQuotationId: string;
  sourceCustomerPoId: string;
  sourceCustomerPoNo: string;
  _codeSource?: Array<"cpo" | "quotation" | "user" | "so"> | null;
  _descriptionSource?: Array<"quote" | "catalog" | "user" | "cpo" | "so"> | null;
  _qtySource?: Array<"cpo" | "quotation" | "user" | "so"> | null;
  _uomSource?: string | null;
  _unitPriceSource?: string | null;
  _discountSource?: string | null;
  _editedBy?: string | null;
  _soEditedBy?: string | null;
  _isAdditional?: boolean;
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
  setGroupId: "",
  setGroupLabel: "",
  setQty: "",
  sourceQuotationId: "",
  sourceCustomerPoId: "",
  sourceCustomerPoNo: "",
  _isAdditional: true,
});

// A product fixed at "trading" or "oem" is inherited silently; "both" (or no
// catalog match at all) is ambiguous and needs an explicit pick on the item.
function resolveSourcingType(productSourcingType: string | null | undefined): "trading" | "oem" | null {
  return productSourcingType === "trading" || productSourcingType === "oem" ? productSourcingType : null;
}

interface ProductCellProps {
  item: LineItem;
  rowIdx: number;
  onUpdate: (key: string, patch: Partial<LineItem>) => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => void;
  onBlur?: (key: string, code: string, prevCode: string) => void;
}

function ProductCell({ item, rowIdx, onUpdate, onCellKeyDown, onBlur: onCodeBlur }: ProductCellProps) {
  const [q, setQ] = useState(item.productCode ?? "");
  const [results, setResults] = useState<{ id: string; productCode: string; description: string | null; uom: string | null; sourcingType?: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeOnFocus = useRef("");
  const currentVal = useRef(item.productCode ?? "");

  useEffect(() => {
    setQ(item.productCode ?? "");
    currentVal.current = item.productCode ?? "";
  }, [item.productCode]);

  function handleInput(val: string) {
    setQ(val);
    currentVal.current = val;
    onUpdate(item._key, { productCode: val, productId: undefined });
    if (debounce.current) clearTimeout(debounce.current);
    if (!val.trim()) { setResults([]); setOpen(false); return; }
    debounce.current = setTimeout(async () => {
      const r = await searchProducts(val);
      if (val !== currentVal.current) return;
      setResults(r);
      setOpen(r.length > 0);
      const exact = r.find((p) => p.productCode.toLowerCase() === val.trim().toLowerCase());
      if (exact) {
        onUpdate(item._key, {
          productId: exact.id,
          productCode: exact.productCode,
          description: item.description || exact.description || "",
          uom: item.uom || exact.uom || "",
          sourcingType: resolveSourcingType(exact.sourcingType),
        });
        setOpen(false);
      }
    }, 300);
  }

  function pick(p: { id: string; productCode: string; description: string | null; uom: string | null; sourcingType?: string | null }) {
    onUpdate(item._key, {
      productId: p.id,
      productCode: p.productCode,
      description: item.description || p.description || "",
      uom: item.uom || p.uom || "",
      sourcingType: resolveSourcingType(p.sourcingType),
    });
    setQ(p.productCode);
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        data-row={rowIdx}
        data-col={0}
        value={q}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={(e) => {
          if (open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) return;
          onCellKeyDown(e, rowIdx, 0);
        }}
        onFocus={() => { codeOnFocus.current = q; }}
        onBlur={() => { setTimeout(() => setOpen(false), 150); onCodeBlur?.(item._key, q, codeOnFocus.current); }}
        className="h-7 text-[11px] md:text-[11px] font-mono"
        placeholder="Code…"
      />
      {open && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-64 rounded-md border border-border bg-background shadow-md max-h-40 overflow-y-auto text-xs">
          {results.map((p) => (
            <button key={p.id} type="button"
              className="w-full text-left px-2 py-1.5 hover:bg-accent flex gap-2"
              onClick={() => pick(p)}
            >
              <span className="font-mono font-medium shrink-0">{p.productCode}</span>
              <span className="text-muted-foreground truncate">{p.description ?? ""}</span>
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

interface Props {
  members: OrgMember[];
  cpo?: CustomerPoForSoCreate | null;
  cpos?: CustomerPoForSoCreate[];
  openCpos?: CustomerPoSearchResult[];
  currentUserName?: string;
  businessType?: string;
}

export function CreateSalesOrderClient({ members, cpo, cpos, openCpos = [], currentUserName = "", businessType = "trading" }: Props) {
  const showSourcing = businessType !== "trading";
  // Normalise: prefer cpos array, fall back to legacy single cpo prop
  const initialCpos = cpos && cpos.length > 0 ? cpos : cpo ? [cpo] : [];
  const router = useRouter();

  // Customer PO combobox
  const [linkedCpos, setLinkedCpos] = useState<LinkedCpo[]>([]);
  const [cpoSearch, setCpoSearch] = useState("");
  const [cpoResults, setCpoResults] = useState<CustomerPoSearchResult[]>([]);
  const [cpoHighlight, setCpoHighlight] = useState(-1);
  const [cpoLoading, setCpoLoading] = useState(false);
  const [cpoDropdownOpen, setCpoDropdownOpen] = useState(false);
  const cpoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cpoDropdownRef = useRef<HTMLDivElement>(null);

  // Quotation search (required)
  const [qtSearch, setQtSearch] = useState("");
  const [qtResults, setQtResults] = useState<Awaited<ReturnType<typeof searchQuotationsByNo>>>([]);
  const [qtHighlight, setQtHighlight] = useState(-1);
  const [linkedQuotations, setLinkedQuotations] = useState<LinkedQuotation[]>([]);
  const [qtLoading, setQtLoading] = useState(false);
  const qtTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Customer
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [custOrgMemberId, setCustOrgMemberId] = useState<string | undefined>();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const custDropdownRef = useRef<HTMLDivElement>(null);
  const qtDropdownRef = useRef<HTMLDivElement>(null);
  const originalSoDropdownRef = useRef<HTMLDivElement>(null);

  // Header
  const spInputRef = useRef<HTMLInputElement>(null);
  const [spInput, setSpInput] = useState("");
  const [salesPersons, setSalesPersons] = useState<{ id: string; name: string; isExt: boolean }[]>([]);
  const [cpoSalesPersons, setCpoSalesPersons] = useState<Record<string, { id: string; name: string; isExt: boolean }[]>>({});
  const [cpoSpInputs, setCpoSpInputs] = useState<Record<string, string>>({});
  const [qtSalesPersons, setQtSalesPersons] = useState<Record<string, { id: string; name: string; isExt: boolean }[]>>({});
  const [qtSpInputs, setQtSpInputs] = useState<Record<string, string>>({});
  const qtSpInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [qtDeliveryDates, setQtDeliveryDates] = useState<Record<string, string>>({});
  const [qtDeliveryAddresses, setQtDeliveryAddresses] = useState<Record<string, string>>({});
  const cpoSpInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryDateInherited, setDeliveryDateInherited] = useState("");
  const [deliveryAddressInherited, setDeliveryAddressInherited] = useState("");
  const [notes, setNotes] = useState("");

  // Order type
  const [soType, setSoType] = useState<"standard" | "proforma" | "urgent">("standard");
  const [proformaReason, setProformaReason] = useState<"sample" | "warranty" | "replacement">("sample");
  const [originalSoSearch, setOriginalSoSearch] = useState("");
  const [originalSoResults, setOriginalSoResults] = useState<Awaited<ReturnType<typeof searchConfirmedSalesOrders>>>([]);
  const [originalSoSearching, setOriginalSoSearching] = useState(false);
  const [selectedOriginalSo, setSelectedOriginalSo] = useState<{ id: string; soNo: string } | null>(null);
  const originalSoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Urgent PO-pending auth fields
  const [urgentAuthType, setUrgentAuthType] = useState<"verbal" | "email" | "loi" | "internal">("verbal");
  const [urgentAuthBy, setUrgentAuthBy] = useState("");
  const [urgentAuthDate, setUrgentAuthDate] = useState(new Date().toISOString().split("T")[0]);
  const [urgentPoExpectedBy, setUrgentPoExpectedBy] = useState("");
  const [urgentAuthNotes, setUrgentAuthNotes] = useState("");

  // Pricing
  const [sstPct, setSstPct] = useState("0");
  const [overallDiscPct, setOverallDiscPct] = useState("0");

  // Items — useId gives a stable ID consistent between SSR and client hydration
  const initialItemId = useId();
  const [items, setItems] = useState<LineItem[]>(() => [{ ...newLine(1), _key: initialItemId }]);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const [saving, setSaving] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);

  // ── Pre-select CPOs from props on mount ─────────────────────────────────────
  useEffect(() => {
    if (initialCpos.length === 0) return;

    // Link all CPOs (include per-CPO delivery + sales person info + inherited tracking)
    setLinkedCpos(initialCpos.map((c) => {
      const addr = c.deliveryAddress
        || [c.customerSnapshot?.organizationName, c.customerSnapshot?.organizationAddress].filter(Boolean).join("\n")
        || null;
      const dateStr = c.deliveryDate ? new Date(c.deliveryDate).toISOString().split("T")[0] : null;
      return {
        id: c.id,
        customerPoNo: c.customerPoNo,
        customerId: c.customerId,
        customerSnapshot: c.customerSnapshot,
        salesPersonName: c.salesPersonName ?? null,
        deliveryDate: c.deliveryDate,
        deliveryAddress: addr,
        _salesPersonInherited: c.salesPersonName ?? null,
        _deliveryDateInherited: dateStr,
        _deliveryAddressInherited: addr,
      };
    }));

    // Auto-link quotations from initial CPOs
    const allQLinks = initialCpos.flatMap((c) => {
      const links = (c.quotationLinks && c.quotationLinks.length > 0)
        ? c.quotationLinks
        : c.quotationId && c.quotationNo
          ? [{ quotationId: c.quotationId, quotationNo: c.quotationNo }]
          : [];
      return links.map((l) => ({ id: l.quotationId, quotationNo: l.quotationNo, _fromCpoId: c.id }));
    });
    if (allQLinks.length > 0) {
      const seen = new Set<string>();
      setLinkedQuotations(allQLinks.filter((q) => { if (seen.has(q.id)) return false; seen.add(q.id); return true; }));
    }

    // Import all items from all CPOs
    const allItems = initialCpos.flatMap((c) => (c.items ?? []).map((i) => ({ ...i, _cpoId: c.id, _cpoNo: c.customerPoNo })));
    if (allItems.length > 0) {
      const codes = [...new Set(allItems.map((i) => i.productCode).filter(Boolean) as string[])];
      getProductsByCode(codes)
        .catch(() => [] as { productCode: string; id: string; sourcingType: string | null }[])
        .then((resolved) => {
          const codeMap = new Map(resolved.map((p) => [p.productCode, p]));
          setItems(
            allItems.map((item, idx) =>
              calcLine({
                _key: uid(),
                rowNo: idx + 1,
                productId: item.productCode ? codeMap.get(item.productCode)?.id : undefined,
                productCode: item.productCode ?? "",
                description: item.description ?? "",
                qty: String(item.qty ?? "1"),
                uom: item.uom ?? "",
                unitPrice: String(item.unitPrice ?? "0"),
                discountPct: String(item.discountPct ?? "0"),
                discountAmt: "0",
                totalPrice: String(item.totalPrice ?? "0"),
                lineType: (item.lineType ?? "sell") as "sell" | "rent",
                rentalDuration: "",
                rentalUnit: "case",
                sourcingType: resolveSourcingType(item.productCode ? codeMap.get(item.productCode)?.sourcingType : null),
                setGroupId: item.setGroupId ?? "",
                setGroupLabel: item.setGroupLabel ?? "",
                setQty: item.setQty ?? "",
                sourceQuotationId: "",
                sourceCustomerPoId: item._cpoId,
                sourceCustomerPoNo: item._cpoNo,
                _codeSource: [item._codeSource === "user" ? "user" : item._codeSource === "quote" ? "quotation" : "cpo"] as Array<"cpo" | "quotation" | "user" | "so">,
                _descriptionSource: item._descriptionSource ?? null,
                _qtySource: [item._qtySource === "user" ? "user" : item._qtySource === "quote" ? "quotation" : "cpo"] as Array<"cpo" | "quotation" | "user" | "so">,
                _uomSource: "cpo",
                _unitPriceSource: item._unitPriceSource === "user" ? "user" : item._unitPriceSource === "quote" ? "quotation" : "cpo",
                _discountSource: "cpo",
                _editedBy: item._editedBy ?? null,
              }),
            ),
          );
        });
    }

    // Inherit delivery fields, sales persons + notes from the first CPO
    const first = initialCpos[0];
    if (first.deliveryDate) {
      const d = new Date(first.deliveryDate).toISOString().split("T")[0];
      setDeliveryDate(d);
      setDeliveryDateInherited(d);
    }
    const addr = first.deliveryAddress || first.customerSnapshot?.organizationAddress;
    if (addr) {
      setDeliveryAddress(addr);
      setDeliveryAddressInherited(addr);
    }
    // Build per-CPO sales person arrays
    const initSpMap: Record<string, { id: string; name: string; isExt: boolean }[]> = {};
    initialCpos.forEach((c) => {
      const list: { id: string; name: string; isExt: boolean }[] = [];
      if (c.salesPersonName) {
        const m = members.find(x => (x.name ?? x.email)?.toLowerCase() === c.salesPersonName!.toLowerCase());
        list.push({ id: m?.userId ?? `sp-${c.salesPersonName}`, name: c.salesPersonName, isExt: !m });
      }
      ((c.associateSalesPersons ?? []) as { id: string; name: string }[]).forEach((a) => {
        const m = members.find(x => x.userId === a.id);
        list.push({ id: a.id, name: a.name, isExt: !m });
      });
      initSpMap[c.id] = list;
    });
    if (Object.keys(initSpMap).length > 0) setCpoSalesPersons(initSpMap);
    // Inherit notes from first CPO if set
    if (first.notes) setNotes(first.notes);
    if (first.customerId) {
      getCustomer(first.customerId)
        .then((cust) => {
          if (!cust) return;
          setSelectedCustomer(cust as unknown as Customer);
          const primary = cust.memberships.find((c) => c.isPrimary) ?? cust.memberships[0];
          if (primary) setCustOrgMemberId(primary.id);
        })
        .catch(() => {
          const snap = first.customerSnapshot;
          if (!snap) return;
          setSelectedCustomer({
            id: first.customerId!,
            title: snap.title ?? null,
            name: snap.name ?? "",
            contactNo: snap.contactNo ?? null,
            email: snap.email ?? null,
            createdAt: new Date(),
            createdByName: null,
            companies: snap.organizationName
              ? [{ id: "__snap__", customerId: first.customerId!, organizationName: snap.organizationName, organizationAddress: snap.organizationAddress ?? null, isPrimary: true, createdAt: new Date() }]
              : [],
          } as unknown as Customer);
          if (snap.organizationName) setCustOrgMemberId("__snap__");
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (cpoDropdownRef.current && !cpoDropdownRef.current.contains(e.target as Node)) {
        setCpoDropdownOpen(false);
        setCpoSearch("");
        setCpoResults([]);
      }
      if (custDropdownRef.current && !custDropdownRef.current.contains(e.target as Node)) {
        setCustResults([]);
      }
      if (qtDropdownRef.current && !qtDropdownRef.current.contains(e.target as Node)) {
        setQtResults([]);
      }
      if (originalSoDropdownRef.current && !originalSoDropdownRef.current.contains(e.target as Node)) {
        setOriginalSoResults([]);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Customer PO search ──────────────────────────────────────────────────────

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

      const inheritedAddr = data.deliveryAddress
        || [data.customerSnapshot?.organizationName, data.customerSnapshot?.organizationAddress].filter(Boolean).join("\n")
        || null;
      const inheritedDate = data.deliveryDate ? new Date(data.deliveryDate).toISOString().split("T")[0] : null;
      const linked: LinkedCpo = {
        id: data.id,
        customerPoNo: data.customerPoNo,
        customerId: data.customerId,
        customerSnapshot: data.customerSnapshot,
        salesPersonName: data.salesPersonName ?? null,
        deliveryDate: data.deliveryDate,
        deliveryAddress: inheritedAddr,
        _salesPersonInherited: data.salesPersonName ?? null,
        _deliveryDateInherited: inheritedDate,
        _deliveryAddressInherited: inheritedAddr,
      };
      setLinkedCpos((prev) => [...prev, linked]);

      // Auto-link quotations from CPO
      const qLinks = (data.quotationLinks && data.quotationLinks.length > 0)
        ? data.quotationLinks
        : data.quotationId && data.quotationNo
          ? [{ quotationId: data.quotationId, quotationNo: data.quotationNo }]
          : [];
      if (qLinks.length > 0) {
        setLinkedQuotations((prev) => {
          const existingIds = new Set(prev.map((q) => q.id));
          const toAdd = qLinks
            .filter((l) => !existingIds.has(l.quotationId))
            .map((l) => ({ id: l.quotationId, quotationNo: l.quotationNo, _fromCpoId: data.id }));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      }

      // Import CPO items (append), resolve productId by code, tag with source CPO
      if (data.items && data.items.length > 0) {
        const codes = data.items.map((i) => i.productCode).filter(Boolean) as string[];
        getProductsByCode(codes)
          .catch(() => [] as { productCode: string; id: string; sourcingType: string | null }[])
          .then((resolved) => {
            const codeMap = new Map(resolved.map((p) => [p.productCode, p]));
            setItems((prev) => {
              const base = prev.filter((i) => i.description || i.productCode);
              const newItems = (data.items ?? []).map((item) =>
                calcLine({
                  _key: uid(),
                  rowNo: 0,
                  productId: item.productCode ? codeMap.get(item.productCode)?.id : undefined,
                  productCode: item.productCode ?? "",
                  description: item.description ?? "",
                  qty: String(item.qty ?? "1"),
                  uom: item.uom ?? "",
                  unitPrice: String(item.unitPrice ?? "0"),
                  discountPct: String(item.discountPct ?? "0"),
                  discountAmt: "0",
                  totalPrice: String(item.totalPrice ?? "0"),
                  lineType: (item.lineType ?? "sell") as "sell" | "rent",
                  rentalDuration: "",
                  rentalUnit: "case",
                  sourcingType: resolveSourcingType(item.productCode ? codeMap.get(item.productCode)?.sourcingType : null),
                  setGroupId: item.setGroupId ?? "",
                  setGroupLabel: item.setGroupLabel ?? "",
                  setQty: item.setQty ?? "",
                  sourceQuotationId: "",
                  sourceCustomerPoId: data.id,
                  sourceCustomerPoNo: data.customerPoNo,
                  _codeSource: [item._codeSource === "user" ? "user" : item._codeSource === "quote" ? "quotation" : "cpo"] as Array<"cpo" | "quotation" | "user" | "so">,
                  _descriptionSource: item._descriptionSource ?? null,
                  _qtySource: [item._qtySource === "user" ? "user" : item._qtySource === "quote" ? "quotation" : "cpo"] as Array<"cpo" | "quotation" | "user" | "so">,
                  _uomSource: "cpo" as const,
                  _unitPriceSource: (item._unitPriceSource === "user" ? "user" : item._unitPriceSource === "quote" ? "quotation" : "cpo"),
                  _discountSource: "cpo" as const,
                  _editedBy: item._editedBy ?? null,
                }),
              );
              return [...base, ...newItems].map((i, idx) => ({ ...i, rowNo: idx + 1 }));
            });
          });
      }

      // Inherit delivery fields and notes from first CPO only
      if (linkedCpos.length === 0) {
        if (!deliveryDate && data.deliveryDate) {
          const d = new Date(data.deliveryDate).toISOString().split("T")[0];
          setDeliveryDate(d);
          setDeliveryDateInherited(d);
        }
        const addr = data.deliveryAddress || data.customerSnapshot?.organizationAddress;
        if (!deliveryAddress && addr) {
          setDeliveryAddress(addr);
          setDeliveryAddressInherited(addr);
        }
        if (!notes && data.notes) setNotes(data.notes);
      }
      // Build sales persons list for this CPO
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

      // Auto-fill customer from first CPO
      if (linkedCpos.length === 0 && data.customerId && !selectedCustomer) {
        getCustomer(data.customerId)
          .then((cust) => {
            if (!cust) return;
            setSelectedCustomer(cust as unknown as Customer);
            const primary = cust.memberships.find((c) => c.isPrimary) ?? cust.memberships[0];
            if (primary) setCustOrgMemberId(primary.id);
          })
          .catch(() => {
            const snap = data.customerSnapshot;
            if (!snap) return;
            setSelectedCustomer({
              id: data.customerId!,
              title: snap.title ?? null,
              name: snap.name ?? "",
              contactNo: snap.contactNo ?? null,
              email: snap.email ?? null,
              createdAt: new Date(),
              createdByName: null,
              companies: snap.organizationName
                ? [{ id: "__snap__", customerId: data.customerId!, organizationName: snap.organizationName, organizationAddress: snap.organizationAddress ?? null, isPrimary: true, createdAt: new Date() }]
                : [],
            } as unknown as Customer);
            if (snap.organizationName) setCustOrgMemberId("__snap__");
          });
      }
      setCpoSearch("");
      setCpoResults([]);
    } catch {
      toast.error("Failed to load customer PO");
    } finally {
      setCpoLoading(false);
    }
  }

  function removeCpo(id: string) {
    setCpoSalesPersons((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setLinkedCpos((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        setSelectedCustomer(null);
        setCustOrgMemberId(undefined);
        setDeliveryDateInherited("");
        setDeliveryAddressInherited("");
      }
      return next;
    });
    // Remove quotations that were auto-linked from this CPO
    setLinkedQuotations((prev) => prev.filter((q) => q._fromCpoId !== id));
    setItems((prev) => {
      const remaining = prev
        .filter((i) => i.sourceCustomerPoId !== id)
        .map((i, idx) => ({ ...i, rowNo: idx + 1 }));
      return remaining.length > 0 ? remaining : [newLine(1)];
    });
  }

  function updateLinkedCpo(id: string, patch: Partial<Pick<LinkedCpo, "salesPersonName" | "deliveryDate" | "deliveryAddress">>) {
    setLinkedCpos((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c));
  }

  // ── Quotation search ────────────────────────────────────────────────────────

  const handleQtSearch = useCallback((val: string) => {
    setQtSearch(val);
    setQtHighlight(-1);
    if (val.length < 2) { setQtResults([]); return; }
    if (qtTimer.current) clearTimeout(qtTimer.current);
    qtTimer.current = setTimeout(async () => {
      const res = await searchQuotationsByNo(val, soType !== "standard");
      setQtResults(res);
      setQtHighlight(-1);
    }, 300);
  }, [soType]);

  function handleQtKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!qtResults.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setQtHighlight((i) => Math.min(i + 1, qtResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setQtHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = qtResults[qtHighlight] ?? qtResults[0];
      if (item) selectQuotation(item.id, item.quotationNo);
    } else if (e.key === "Escape") {
      setQtResults([]);
      setQtHighlight(-1);
    }
  }

  async function selectQuotation(qtId: string, qtNo: string) {
    if (linkedQuotations.some((q) => q.id === qtId)) {
      setQtSearch(""); setQtResults([]); return;
    }
    setQtSearch("");
    setQtResults([]);
    setQtLoading(true);
    try {
      const qt = await getQuotationForSO(qtId);
      if (!qt) return;

      const isFirst = linkedQuotations.length === 0;
      setLinkedQuotations((prev) => [...prev, {
        id: qt.id,
        quotationNo: qt.quotationNo,
        customerId: qt.customerId ?? null,
        customerSnapshot: qt.customerSnapshot ?? null,
        salesPersonName: qt.salesPersonName ?? null,
      }]);
      // Auto-fill per-quotation sales person for urgent/proforma SO
      if (soType !== "standard" && qt.salesPersonName && !qtSalesPersons[qt.id]?.length) {
        const m = members.find((x) => (x.name ?? x.email)?.toLowerCase() === qt.salesPersonName!.toLowerCase());
        setQtSalesPersons((prev) => ({ ...prev, [qt.id]: [{ id: m?.userId ?? `sp-${qt.salesPersonName}`, name: qt.salesPersonName!, isExt: !m }] }));
      }
      // Auto-populate delivery address from customerSnapshot for urgent/proforma SO
      if (soType !== "standard") {
        const snap = qt.customerSnapshot as { organizationName?: string; organizationAddress?: string } | null;
        const autoAddr = [snap?.organizationName, snap?.organizationAddress].filter(Boolean).join("\n");
        if (autoAddr) setQtDeliveryAddresses((prev) => ({ ...prev, [qt.id]: autoAddr }));
      }

      // Append items (renumber after existing), tag with source quotation
      const newItems = qt.items.map((item) =>
        calcLine({
          _key: uid(),
          rowNo: 0, // renumbered below
          productId: item.productId ?? undefined,
          productCode: item.productCode ?? "",
          description: item.description ?? "",
          qty: String(item.qty ?? "1"),
          uom: item.uom ?? "",
          unitPrice: String(item.unitPrice ?? "0"),
          discountPct: String(item.discountPct ?? "0"),
          discountAmt: String(item.discountAmt ?? "0"),
          totalPrice: String(item.totalPrice ?? "0"),
          lineType: (item.lineType ?? "sell") as "sell" | "rent",
          rentalDuration: item.rentalDuration ?? "",
          rentalUnit: item.rentalUnit ?? "case",
          setGroupId: item.setGroupId ?? "",
          setGroupLabel: item.setGroupLabel ?? "",
          setQty: item.setQty ?? "",
          sourceQuotationId: qt.id,
          sourceCustomerPoId: "",
          sourceCustomerPoNo: "",
          _codeSource: ["quotation"] as Array<"cpo" | "quotation" | "user" | "so">,
          _descriptionSource: ["quote"] as Array<"quote" | "catalog" | "user" | "cpo" | "so">,
          _qtySource: ["quotation"] as Array<"cpo" | "quotation" | "user" | "so">,
          _uomSource: "quotation" as const,
          _unitPriceSource: "quotation" as const,
          _discountSource: "quotation" as const,
        }),
      );
      setItems((prev) => {
        const base = isFirst ? [] : prev.filter((i) => i.description || i.productCode);
        const combined = [...base, ...newItems];
        return combined.map((i, idx) => ({ ...i, rowNo: idx + 1 }));
      });

      // Auto-fill header fields from the first quotation only
      if (isFirst) {
        setSstPct(qt.sstPct ?? "0");
        setOverallDiscPct(qt.overallDiscountPct ?? "0");
        if (qt.notes && !notes) setNotes(qt.notes);
      }

      // Auto-fill customer whenever not yet set
      if (!selectedCustomer && qt.customerId) {
        const cust = await getCustomer(qt.customerId);
        if (cust) {
          setSelectedCustomer(cust as unknown as Customer);
          const primary = cust.memberships.find((c) => c.isPrimary);
          if (primary) setCustOrgMemberId(primary.id);
          else if (cust.memberships.length === 1) setCustOrgMemberId(cust.memberships[0].id);
        } else if (qt.customerSnapshot) {
          // Customer belongs to a sibling org (dummy quotation) or was deleted — use snapshot
          const snap = qt.customerSnapshot;
          setSelectedCustomer({
            id: qt.customerId,
            title: snap.title ?? null,
            name: snap.name ?? "",
            contactNo: snap.contactNo ?? null,
            email: snap.email ?? null,
            createdAt: new Date(),
            createdByName: null,
            companies: snap.organizationName
              ? [{ id: "__snap__", customerId: qt.customerId, organizationName: snap.organizationName, organizationAddress: snap.organizationAddress ?? null, isPrimary: true, createdAt: new Date() }]
              : [],
          } as unknown as Customer);
          if (snap.organizationName) setCustOrgMemberId("__snap__");
        }
      }

      // Auto-fill sales person from quotation when no CPO is linked (urgent / proforma)
      if (isFirst && linkedCpos.length === 0 && salesPersons.length === 0 && qt.salesPersonName) {
        const spList: typeof salesPersons = [];
        const m = members.find((x) => (x.name ?? x.email)?.toLowerCase() === qt.salesPersonName!.toLowerCase());
        spList.push({ id: m?.userId ?? `sp-${qt.salesPersonName}`, name: qt.salesPersonName, isExt: !m });
        ((qt.associateSalesPersons ?? []) as { id: string; name: string }[]).forEach((a) => {
          const am = members.find((x) => x.userId === a.id);
          spList.push({ id: a.id, name: a.name, isExt: !am });
        });
        setSalesPersons(spList);
      }
    } catch {
      toast.error("Failed to load quotation");
    } finally {
      setQtLoading(false);
    }
  }

  function removeLinkedQuotation(id: string) {
    setLinkedQuotations((prev) => prev.filter((q) => q.id !== id));
  }

  // ── Set / group helpers ─────────────────────────────────────────────────────

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

  async function handleProductCodeBlur(key: string, code: string, prevCode: string) {
    const trimmed = code.trim();
    if (!trimmed || trimmed === prevCode.trim()) return;
    const product = await getProductByCode(trimmed);
    if (!product) {
      setItems((prev) => prev.map((i) => i._key === key ? { ...i, description: "N/A" } : i));
      return;
    }
    setItems((prev) => prev.map((i) => i._key === key
      ? {
          ...i,
          description: product.description ?? "N/A",
          uom: product.uom ?? i.uom,
          _descriptionSource: ["catalog"],
          sourcingType: resolveSourcingType(product.sourcingType),
        }
      : i,
    ));
  }

  const [cpoPicker, setCpoPicker] = useState<string | null>(null);
  const [cpoPickerPos, setCpoPickerPos] = useState<{ top: number; left: number } | null>(null);
  const dragKey        = useRef<string | null>(null);
  const [isDragging, setIsDragging]   = useState(false);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const dragClientY = useRef<number>(0);
  const dragRafId   = useRef<number | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  function getRowKeyAtY(clientY: number): string | null {
    const rows = tableRef.current?.querySelectorAll<HTMLElement>("[data-key]");
    if (!rows) return null;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return row.dataset.key ?? null;
    }
    return null;
  }

  // Window-level drag listeners — active only while a drag is in progress.
  // This avoids inputs / selects inside rows intercepting dragover / drop.
  useEffect(() => {
    if (!isDragging) return;

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      dragClientY.current = e.clientY;
      const key = getRowKeyAtY(e.clientY);
      setDragOverKey((prev) => (prev !== key ? key : prev));
      // auto-scroll table container
      const el = tableScrollRef.current;
      if (el) {
        const ZONE = 80, SPEED = 10;
        const rect = el.getBoundingClientRect();
        const rel  = e.clientY - rect.top;
        if (rel < ZONE && rel >= 0)                        el.scrollTop -= SPEED * (1 - rel / ZONE);
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

  // ── Cell keyboard navigation ────────────────────────────────────────────────

  function handleCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    colIdx: number,
  ) {
    const COLS = soType === "proforma" ? 4 : 6;
    const isModifier = e.metaKey || e.ctrlKey;

    const focus = (r: number, c: number) => {
      const target = tableRef.current?.querySelector<HTMLInputElement>(
        `[data-row="${r}"][data-col="${c}"]`,
      );
      if (target) { target.focus(); target.select(); }
    };

    switch (e.key) {
      case "ArrowDown":
        if (!isModifier) break;
        e.preventDefault();
        focus(rowIdx + 1, colIdx);
        break;
      case "ArrowUp":
        if (!isModifier) break;
        e.preventDefault();
        if (rowIdx > 0) focus(rowIdx - 1, colIdx);
        break;
      case "Enter":
        e.preventDefault();
        if (rowIdx < items.length - 1) {
          focus(rowIdx + 1, colIdx);
        } else {
          addLine();
          setTimeout(() => focus(rowIdx + 1, 0), 0);
        }
        break;
      case "ArrowRight":
        if (!isModifier) break;
        e.preventDefault();
        if (colIdx < COLS - 1) focus(rowIdx, colIdx + 1);
        else focus(rowIdx + 1, 0);
        break;
      case "ArrowLeft":
        if (!isModifier) break;
        e.preventDefault();
        if (colIdx > 0) focus(rowIdx, colIdx - 1);
        else if (rowIdx > 0) focus(rowIdx - 1, COLS - 1);
        break;
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function buildAndCreate() {
    if (linkedQuotations.length === 0) {
      toast.error("Please link at least one quotation");
      return null;
    }
    if (soType === "standard" && linkedCpos.length === 0) {
      toast.error("Please link at least one Customer PO");
      return null;
    }
    if (soType === "urgent" && !urgentAuthBy.trim()) {
      toast.error("Please enter the name of the person who authorized this urgent order");
      return null;
    }
    const primaryCustomerId = selectedCustomer?.id
      ?? linkedCpos.find((c) => c.customerId)?.customerId
      ?? linkedQuotations.find((q) => q.customerId)?.customerId
      ?? null;
    if (!primaryCustomerId) { toast.error("Please select a customer"); return null; }
    if (!items.some((i) => i.description || i.productCode)) { toast.error("Add at least one item"); return null; }
    if (linkedCpos.length > 0) {
      for (const cpo of linkedCpos) {
        if (!cpoSalesPersons[cpo.id]?.length) {
          toast.error(`Sales person required for ${cpo.customerPoNo}`);
          return null;
        }
      }
    } else if (soType !== "standard" && linkedQuotations.length > 0) {
      for (const qt of linkedQuotations) {
        if (!qtSalesPersons[qt.id]?.length) {
          toast.error(`Sales person required for ${qt.quotationNo}`);
          return null;
        }
      }
    } else {
      if (salesPersons.length === 0) {
        toast.error("Sales person is required");
        return null;
      }
    }

    const { subtotal, overallDiscAmt, sstAmt, grand } = soType === "proforma"
      ? { subtotal: 0, overallDiscAmt: 0, sstAmt: 0, grand: 0 }
      : calcTotals(items, sstPct, overallDiscPct);
    return createSalesOrder({
      soType,
      proformaReason: soType === "proforma" ? proformaReason : undefined,
      originalSoId: soType === "proforma" && selectedOriginalSo ? selectedOriginalSo.id : undefined,
      originalSoNo: soType === "proforma" && selectedOriginalSo ? selectedOriginalSo.soNo : undefined,
      urgentAuthType: soType === "urgent" ? urgentAuthType : undefined,
      urgentAuthBy: soType === "urgent" ? urgentAuthBy.trim() || undefined : undefined,
      urgentAuthDate: soType === "urgent" ? urgentAuthDate || undefined : undefined,
      urgentPoExpectedBy: soType === "urgent" ? urgentPoExpectedBy || undefined : undefined,
      urgentAuthNotes: soType === "urgent" ? urgentAuthNotes.trim() || undefined : undefined,
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
      linkedQuotations: linkedQuotations.length > 0
        ? (soType !== "standard"
            ? linkedQuotations.map((qt) => ({
                ...qt,
                salesPersonName: qtSalesPersons[qt.id]?.[0]?.name ?? qt.salesPersonName ?? null,
                deliveryDate: qtDeliveryDates[qt.id] ?? null,
                deliveryAddress: qtDeliveryAddresses[qt.id] ?? null,
              }))
            : linkedQuotations)
        : undefined,
      salesPersonName: linkedCpos.length > 0
        ? (cpoSalesPersons[linkedCpos[0]?.id]?.[0]?.name || undefined)
        : soType !== "standard" && linkedQuotations.length > 0
          ? (qtSalesPersons[linkedQuotations[0]?.id]?.[0]?.name || undefined)
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
      deliveryDate: (() => {
        if (soType !== "standard" && linkedQuotations.length > 0) {
          const d = qtDeliveryDates[linkedQuotations[0].id];
          return d ? new Date(d) : undefined;
        }
        const d = linkedCpos[0]?.deliveryDate || deliveryDate;
        return d ? new Date(d) : undefined;
      })(),
      deliveryAddress: soType !== "standard" && linkedQuotations.length > 0
        ? (qtDeliveryAddresses[linkedQuotations[0].id] || undefined)
        : ((linkedCpos[0]?.deliveryAddress || deliveryAddress) || undefined),
      notes: notes || undefined,
      subtotal: subtotal.toFixed(2),
      overallDiscountPct: overallDiscPct,
      overallDiscountAmt: overallDiscAmt.toFixed(2),
      sstPct,
      sst: sstAmt.toFixed(2),
      grandTotal: grand.toFixed(2),
      items: items.map(({ _key, lineType, rentalDuration, rentalUnit, setGroupId, setGroupLabel, setQty, sourceQuotationId, sourceCustomerPoId, sourceCustomerPoNo, _codeSource, _descriptionSource, _qtySource, _uomSource, _unitPriceSource, _discountSource, _editedBy, _soEditedBy, _isAdditional, ...rest }) => ({
        ...rest,
        unitPrice: soType === "proforma" ? "0" : rest.unitPrice,
        discountPct: soType === "proforma" ? "0" : rest.discountPct,
        discountAmt: soType === "proforma" ? "0" : rest.discountAmt,
        totalPrice: soType === "proforma" ? "0" : rest.totalPrice,
        lineType,
        rentalDuration: rentalDuration || undefined,
        rentalUnit: rentalUnit || undefined,
        setGroupId: setGroupId || undefined,
        setGroupLabel: setGroupLabel || undefined,
        setQty: setQty || undefined,
        sourceQuotationId: sourceQuotationId || undefined,
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
      })),
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const so = await buildAndCreate();
      if (!so) return;
      toast.success("Sales order created");
      router.push(cpo ? `/dashboard/sales/customer-po/${cpo.id}` : "/dashboard/sales/order");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAndSubmit() {
    setSaving(true);
    try {
      const so = await buildAndCreate();
      if (!so) return;
      await submitSalesOrder(so.id);
      toast.success("Sales order created and submitted for approval");
      router.push(cpo ? `/dashboard/sales/customer-po/${cpo.id}` : "/dashboard/sales/order");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const { subtotal, overallDiscAmt, sstAmt, grand } = calcTotals(items, sstPct, overallDiscPct);
  const allCompanies = selectedCustomer?.companies ?? [];
  const linkedCustomers = linkedQuotations.filter((q) => q.customerId || q.customerSnapshot);

  // Deduplicated customers from linked CPOs (by customerId or org name)
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

  // Show CPO column when >1 CPO is linked (items need to know which customer they're for)
  const showCpoColumn = linkedCpos.length > 1;
  // Unique customer IDs across all linked CPOs
  const cpoCustomerIds = [...new Set(linkedCpos.map((c) => c.customerId).filter(Boolean))];
  const multiCustomerSo = cpoCustomerIds.length > 1;

  return (
    <div className="p-6">
      <PageHeader
        title="New Sales Order"
        description="Create a new sales order"
        action={
          <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/sales/order")} className="gap-2">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <div className="space-y-6">

        {/* ── 0. Order type ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Order type</h2>
          <div className="flex flex-wrap gap-2 items-center">
            {(["standard", "proforma", "urgent"] as const).map((t) => {
              const blockedByCpo = linkedCpos.length > 0 && (t === "urgent" || t === "proforma");
              const blockedByQuotation = t === "standard" && linkedQuotations.length > 0 && soType !== "standard";
              const isBlocked = blockedByCpo || blockedByQuotation;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={isBlocked}
                  onClick={() => {
                    if (blockedByCpo) { toast.error("Remove linked CPOs before switching to this order type"); return; }
                    if (blockedByQuotation) { toast.error("Remove linked quotations before switching to Standard"); return; }
                    setSoType(t);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    isBlocked
                      ? "border-border text-muted-foreground/40 cursor-not-allowed opacity-50"
                      : soType === t
                        ? t === "proforma"
                          ? "bg-violet-600 text-white border-violet-600"
                          : t === "urgent"
                            ? "bg-amber-500 text-white border-amber-500"
                            : "bg-foreground text-background border-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/40"
                  }`}
                >
                  {t === "standard" ? "Standard" : t === "proforma" ? "Pro-forma" : "Urgent"}
                </button>
              );
            })}
            {linkedCpos.length > 0 && (
              <span className="text-[10px] text-muted-foreground">Pro-forma and Urgent require no CPO</span>
            )}
            {soType !== "standard" && linkedQuotations.length > 0 && (
              <span className="text-[10px] text-muted-foreground">Remove linked quotations to switch to Standard</span>
            )}
            {soType === "standard" && linkedCpos.length === 0 && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">Standard SO requires at least one CPO to submit</span>
            )}
          </div>
          {soType === "urgent" && (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/50">
                <span className="text-xs text-amber-800 dark:text-amber-300">
                  Urgent orders are placed before the customer PO is issued. A CPO can be linked later. Authorization details below are required for audit.
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Authorization channel <span className="text-destructive">*</span></Label>
                  <div className="flex gap-2">
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
                  <Label className="text-xs text-muted-foreground">Authorized by (customer contact) <span className="text-destructive">*</span></Label>
                  <Input
                    value={urgentAuthBy}
                    onChange={(e) => setUrgentAuthBy(e.target.value)}
                    placeholder="Name of person who approved…"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">CPO expected by <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <input
                    type="date"
                    value={urgentPoExpectedBy}
                    onChange={(e) => setUrgentPoExpectedBy(e.target.value)}
                    className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Reference / notes <span className="text-muted-foreground font-normal">(optional — e.g. email subject, call reference)</span></Label>
                  <Input
                    value={urgentAuthNotes}
                    onChange={(e) => setUrgentAuthNotes(e.target.value)}
                    placeholder="e.g. Email from John on 25 Jun re: urgent delivery for Ward 5…"
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          )}
          {soType === "proforma" && (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-violet-50 dark:bg-violet-900/15 border border-violet-200 dark:border-violet-800/50">
                <span className="text-xs text-violet-800 dark:text-violet-300">
                  Pro-forma orders are not revenue transactions. Stock goes out but no commercial invoice is raised.
                </span>
              </div>
              <div className="flex gap-2">
                {(["sample", "warranty", "replacement"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setProformaReason(r);
                      if (r === "sample") { setSelectedOriginalSo(null); setOriginalSoSearch(""); setOriginalSoResults([]); }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize ${
                      proformaReason === r
                        ? "bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-300 border-violet-300 dark:border-violet-700"
                        : "border-border text-muted-foreground hover:border-foreground/30"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {/* Original SO — only for warranty / replacement */}
              {(proformaReason === "warranty" || proformaReason === "replacement") && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Original Sales Order <span className="text-destructive">*</span>
                  </Label>
                  {selectedOriginalSo ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20">
                      <span className="text-sm font-mono font-medium text-violet-800 dark:text-violet-300 flex-1">{selectedOriginalSo.soNo}</span>
                      <button
                        type="button"
                        onClick={() => { setSelectedOriginalSo(null); setOriginalSoSearch(""); setOriginalSoResults([]); }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <XIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative" ref={originalSoDropdownRef}>
                      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        value={originalSoSearch}
                        onKeyDown={(e) => { if (e.key === "Escape") { setOriginalSoResults([]); setOriginalSoSearch(""); } }}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOriginalSoSearch(val);
                          if (originalSoTimer.current) clearTimeout(originalSoTimer.current);
                          originalSoTimer.current = setTimeout(async () => {
                            setOriginalSoSearching(true);
                            try {
                              const r = await searchConfirmedSalesOrders(val, { includeStatuses: ["confirmed", "fulfilled"] });
                              setOriginalSoResults(r);
                            } finally {
                              setOriginalSoSearching(false);
                            }
                          }, 300);
                        }}
                        placeholder="Search original SO number…"
                        className="pl-9 h-9 text-sm"
                      />
                      {originalSoSearching && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">Searching…</span>
                      )}
                      {originalSoResults.length > 0 && (
                        <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                          {originalSoResults.map((so) => {
                            const snap = so.customerSnapshot as any;
                            return (
                              <button
                                key={so.id}
                                type="button"
                                className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0"
                                onClick={() => {
                                  setSelectedOriginalSo({ id: so.id, soNo: so.soNo });
                                  setOriginalSoSearch("");
                                  setOriginalSoResults([]);
                                }}
                              >
                                <div className="text-sm font-mono font-medium">{so.soNo}</div>
                                {snap?.organizationName && (
                                  <div className="text-[11px] text-muted-foreground">{snap.organizationName}</div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── CPO context banner ── */}
        {soType !== "proforma" && cpo && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm">
            <LinkIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="text-blue-800 dark:text-blue-300">
              Creating sales order for Customer PO{" "}
              <span className="font-mono font-semibold">{cpo.customerPoNo}</span>
            </span>
          </div>
        )}

        {/* ── 1. Linked Customer POs ── */}
        {soType !== "proforma" && <section className="border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">
              Customer POs{" "}
              {soType === "standard"
                ? <span className="text-destructive">*</span>
                : <span className="text-muted-foreground font-normal text-xs">(optional — link when PO arrives)</span>}
            </h2>
          </div>

          <div className="relative" ref={cpoDropdownRef}>
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
                const fmtD = (d: Date | string | null | undefined) =>
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
                              r.status === "received" ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                              : r.status === "acknowledged" ? "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
                              : r.status === "fulfilled" ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                              : r.status === "cancelled" ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
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
        </section>}

        {/* ── 2. Linked Quotations ── */}
        {(soType !== "proforma" || proformaReason === "sample") && (
          <section className="border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">
                Quotations <span className="text-destructive">*</span>
              </h2>
            </div>

            {soType === "standard" ? (
              /* Standard — read-only, auto-populated from CPO */
              <div>
                {linkedQuotations.length > 0 ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    {linkedQuotations.map((q) => (
                      <span key={q.id} className="flex items-center gap-1.5 text-[11px] bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 rounded-full px-2.5 py-1 font-mono">
                        <FileTextIcon className="w-3 h-3" />
                        {q.quotationNo}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    {linkedCpos.length === 0
                      ? "Link a Customer PO above — quotations will appear here automatically."
                      : "No quotations found on the linked CPO."}
                  </p>
                )}
              </div>
            ) : (
              /* Urgent / Pro-forma sample — manual search */
              <div className="space-y-2">
                {linkedQuotations.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {linkedQuotations.map((q) => (
                      <span key={q.id} className="flex items-center gap-1 text-[11px] bg-muted border border-border/60 rounded-full px-2.5 py-1 font-mono">
                        <FileTextIcon className="w-3 h-3 text-muted-foreground" />
                        {q.quotationNo}
                        <button onClick={() => removeLinkedQuotation(q.id)} className="text-muted-foreground hover:text-foreground ml-0.5">
                          <XIcon className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative" ref={qtDropdownRef}>
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none z-10" />
                  <Input
                    value={qtSearch}
                    onChange={(e) => handleQtSearch(e.target.value)}
                    onKeyDown={handleQtKeyDown}
                    placeholder={linkedQuotations.length === 0 ? "Search quotation no.…" : "Add another quotation…"}
                    className="pl-9 h-9 text-sm"
                    disabled={qtLoading}
                  />
                  {qtLoading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">Loading…</span>}
                  {qtResults.length > 0 && (
                    <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
                      {qtResults.map((qt, idx) => {
                        const snap = qt.customerSnapshot as any;
                        const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
                        const alreadyLinked = linkedQuotations.some((q) => q.id === qt.id);
                        return (
                          <button
                            key={qt.id}
                            disabled={alreadyLinked}
                            className={`w-full text-left px-3 py-2 transition-colors border-b border-border/30 last:border-0 disabled:opacity-40 ${idx === qtHighlight ? "bg-muted" : "hover:bg-muted/50"}`}
                            onClick={() => selectQuotation(qt.id, qt.quotationNo)}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-mono font-medium">{qt.quotationNo}{alreadyLinked ? " (added)" : ""}</span>
                              {qt.isDummy === 1 && (
                                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded border border-muted-foreground/30 bg-muted text-muted-foreground">Dummy</span>
                              )}
                            </div>
                            {custName && <div className="text-[11px] text-muted-foreground">{custName}</div>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── 3. Customer ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">
            Customer{(linkedCustomers.length > 1 || cpoLinkedCustomers.length > 1) ? "s" : ""}
          </h2>

          {soType === "standard" ? (
            /* Standard — auto-populated from CPO, not editable */
            cpoLinkedCustomers.length > 0 ? (
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
            ) : (
              <p className="text-sm text-muted-foreground italic">Link a Customer PO above — customer will appear here automatically.</p>
            )
          ) : linkedCustomers.length > 0 ? (
            <div className="divide-y divide-border/40">
              {linkedCustomers.map((lq) => {
                const snap = lq.customerSnapshot;
                if (!snap) return null;
                const name = [snap.title, snap.name].filter(Boolean).join(" ");
                return (
                  <div key={lq.id} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">{name}</span>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">via {lq.quotationNo}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      <BuildingIcon className="w-3 h-3 shrink-0" />{snap.organizationName || "—"}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : cpoLinkedCustomers.length > 0 ? (
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
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Order details</h2>

          {/* Per-quotation (urgent) or per-CPO (standard) delivery table */}
          <div className="overflow-x-auto mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left pb-2 pr-3 w-40 font-medium">{soType !== "standard" ? "Quotation" : "CPO / Type"}</th>
                  <th className="text-left pb-2 pr-3 font-medium">Sales person</th>
                  <th className="text-left pb-2 pr-3 w-36 font-medium">Due delivery</th>
                  <th className="text-left pb-2 font-medium">Delivery address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {soType !== "standard" && linkedCpos.length === 0 && linkedQuotations.length > 0 ? (
                  // Urgent/proforma SO: per-quotation rows
                  linkedQuotations.map((qt) => {
                    const snap = qt.customerSnapshot;
                    const custDisplay = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
                    const orgName = (snap as any)?.organizationName ?? null;
                    const qtId = qt.id;
                    const qtSpList = qtSalesPersons[qtId] ?? [];
                    return (
                      <tr key={qtId}>
                        <td className="py-2 pr-3 align-top">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md font-mono text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800">{soType === "urgent" ? "CPO To Follow" : "Pro-forma"}</span>
                            <span className="text-[11px] font-mono font-semibold">{qt.quotationNo}</span>
                          </div>
                          {custDisplay && <div className="text-[10px] text-muted-foreground mt-0.5">{custDisplay}{orgName ? ` · ${orgName}` : ""}</div>}
                        </td>
                        <td className="py-2 pr-3 align-top">
                          <div
                            className="min-h-9 rounded-md border border-input bg-background px-2 py-1.5 flex flex-wrap gap-1.5 items-center cursor-text focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring transition-colors"
                            onClick={() => qtSpInputRefs.current[qtId]?.focus()}
                          >
                            {qtSpList.map((s) => (
                              <span key={s.id} className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded px-2 py-0.5 shrink-0">
                                {s.name}
                                {s.isExt && <span className="relative -top-0.75 text-[8px] font-bold leading-none">ext</span>}
                                <button type="button" onClick={(e) => { e.stopPropagation(); setQtSalesPersons((prev) => ({ ...prev, [qtId]: (prev[qtId] ?? []).filter((x) => x.id !== s.id) })); }} className="text-blue-500/60 hover:text-blue-700 ml-0.5"><XIcon className="w-3 h-3" /></button>
                              </span>
                            ))}
                            <select value="" onClick={(e) => e.stopPropagation()} onChange={(e) => {
                              const m = members.find((x) => x.userId === e.target.value);
                              if (!m) return;
                              const mName = (m.name ?? m.email).toLowerCase();
                              if (qtSpList.some((s) => s.id === m.userId || s.name.toLowerCase() === mName)) return;
                              setQtSalesPersons((prev) => ({ ...prev, [qtId]: [...(prev[qtId] ?? []), { id: m.userId, name: m.name ?? m.email, isExt: false }] }));
                            }} className="h-6 text-xs bg-transparent border-0 outline-none text-muted-foreground cursor-pointer">
                              <option value="">+ member</option>
                              {members.filter((m) => !qtSpList.some((s) => s.id === m.userId || s.name.toLowerCase() === (m.name ?? m.email).toLowerCase())).map((m) => (
                                <option key={m.userId} value={m.userId}>{m.name?.toLowerCase() ?? m.email}</option>
                              ))}
                            </select>
                            <input
                              ref={(el) => { qtSpInputRefs.current[qtId] = el; }}
                              type="text"
                              value={qtSpInputs[qtId] ?? ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val.includes(",")) {
                                  const parts = val.split(",");
                                  const toAdd = parts.slice(0, -1).map((p) => p.trim()).filter(Boolean);
                                  if (toAdd.length) {
                                    const memberNames = new Set(members.map((m) => (m.name ?? m.email).toLowerCase()));
                                    const blocked = toAdd.filter((n) => memberNames.has(n.toLowerCase()));
                                    if (blocked.length) { toast.error(`"${blocked.join('", "')}" is a member`); }
                                    const t = Date.now();
                                    setQtSalesPersons((prev) => {
                                      const cur = prev[qtId] ?? [];
                                      const existing = new Set(cur.map((s) => s.name.toLowerCase()));
                                      const unique = toAdd.filter((n) => !existing.has(n.toLowerCase()) && !memberNames.has(n.toLowerCase()));
                                      return unique.length ? { ...prev, [qtId]: [...cur, ...unique.map((name, i) => ({ id: `ext-${t}-${i}`, name, isExt: true }))] } : prev;
                                    });
                                  }
                                  setQtSpInputs((prev) => ({ ...prev, [qtId]: parts[parts.length - 1].trimStart() }));
                                } else { setQtSpInputs((prev) => ({ ...prev, [qtId]: val })); }
                              }}
                              onKeyDown={(e) => {
                                const cur = qtSpInputs[qtId] ?? "";
                                if (e.key === "Backspace" && !cur && qtSpList.length > 0) {
                                  setQtSalesPersons((prev) => ({ ...prev, [qtId]: (prev[qtId] ?? []).slice(0, -1) })); return;
                                }
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  if (!cur.trim()) return;
                                  const names = cur.split(",").map((p) => p.trim()).filter(Boolean);
                                  const memberNames = new Set(members.map((m) => (m.name ?? m.email).toLowerCase()));
                                  const blocked = names.filter((n) => memberNames.has(n.toLowerCase()));
                                  if (blocked.length) { toast.error(`"${blocked.join('", "')}" is a member`); return; }
                                  const t = Date.now();
                                  setQtSalesPersons((prev) => {
                                    const existing = new Set((prev[qtId] ?? []).map((s) => s.name.toLowerCase()));
                                    const unique = names.filter((n) => !existing.has(n.toLowerCase()));
                                    return unique.length ? { ...prev, [qtId]: [...(prev[qtId] ?? []), ...unique.map((name, i) => ({ id: `ext-${t}-${i}`, name, isExt: true }))] } : prev;
                                  });
                                  setQtSpInputs((prev) => ({ ...prev, [qtId]: "" }));
                                }
                              }}
                              placeholder={qtSpList.length === 0 ? "Type a name… (Enter or , to add)" : ""}
                              className="flex-1 min-w-24 h-6 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                            />
                          </div>
                        </td>
                        <td className="py-2 pr-3 align-top">
                          <input
                            type="date"
                            value={qtDeliveryDates[qtId] ?? ""}
                            onChange={(e) => setQtDeliveryDates((prev) => ({ ...prev, [qtId]: e.target.value }))}
                            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="py-2 align-top">
                          <Textarea
                            value={qtDeliveryAddresses[qtId] ?? ""}
                            onChange={(e) => setQtDeliveryAddresses((prev) => ({ ...prev, [qtId]: e.target.value }))}
                            placeholder={"Organization name\nFull address"}
                            rows={2}
                            className="text-xs resize-none"
                          />
                        </td>
                      </tr>
                    );
                  })
                ) : linkedCpos.length === 0 ? (
                  // Cash sale row — uses global state fields
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
                    const dateVal = cpo.deliveryDate
                      ? new Date(cpo.deliveryDate).toISOString().split("T")[0]
                      : "";
                    const spSame = cpo._salesPersonInherited && cpo.salesPersonName === cpo._salesPersonInherited;
                    const dateSame = cpo._deliveryDateInherited && dateVal === cpo._deliveryDateInherited;
                    const addrSame = cpo._deliveryAddressInherited && (cpo.deliveryAddress ?? "") === cpo._deliveryAddressInherited;
                    const tagFrom = <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800"><LinkIcon className="w-2.5 h-2.5 shrink-0" />from CPO</span>;
                    const tagEdited = <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"><PencilIcon className="w-2.5 h-2.5 shrink-0" />{currentUserName || "user"} edited</span>;
                    return (
                      <tr key={cpo.id}>
                        <td className="py-2 pr-3 align-top">
                          <span className="font-mono text-[11px] font-semibold">{cpo.customerPoNo}</span>
                        </td>
                        <td className="py-2 pr-3 align-top">
                          <div className="space-y-1">
                            {cpo._salesPersonInherited && (spSame ? tagFrom : tagEdited)}
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
                            {cpo._deliveryDateInherited && (dateSame ? tagFrom : tagEdited)}
                            <input
                              type="date"
                              value={dateVal}
                              onChange={(e) => updateLinkedCpo(cpo.id, { deliveryDate: e.target.value || null })}
                              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>
                        </td>
                        <td className="py-2 align-top">
                          <div className="space-y-1">
                            {cpo._deliveryAddressInherited && (addrSame ? tagFrom : tagEdited)}
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

        {/* ── 4. Items table ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Items</h2>

          <div ref={tableScrollRef} className="overflow-x-auto overflow-y-auto max-h-[55vh]">
            <table className="w-full text-xs" ref={tableRef}>
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border text-muted-foreground tracking-wider">
                  <th className="text-left align-bottom pb-2 pr-2 w-8 uppercase">#</th>
                  <th className="text-left align-bottom pb-2 pr-2 w-24 uppercase">Code</th>
                  <th className="text-left align-bottom pb-2 pr-2 uppercase">Description</th>
                  <th className="text-right align-bottom pb-2 pr-2 w-16 uppercase">Qty/Set</th>
                  {soType !== "proforma" && <th className="text-center align-bottom pb-2 pr-2 w-16 uppercase">Total qty</th>}
                  <th className="text-left align-bottom pb-2 pr-2 w-14 uppercase">UOM</th>
                  {soType !== "proforma" && <th className="text-right align-bottom pb-2 pr-2 w-24 uppercase">Unit price</th>}
                  {soType !== "proforma" && <th className="text-right align-bottom pb-2 pr-2 w-24 uppercase">Total unit price</th>}
                  {soType === "standard" && linkedQuotations.some((q) => q.customerId || q.customerSnapshot) && (
                    <th className="text-left align-bottom pb-2 pr-2 w-28 uppercase">Customer</th>
                  )}
                  <th className="w-14" />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const hasQuotationCustomers = soType === "standard" && linkedQuotations.some((q) => q.customerId || q.customerSnapshot);
                  const colCount = 5 + (soType !== "proforma" ? 3 : 0) + (hasQuotationCustomers ? 1 : 0) + 1;
                  // Build color index map: each unique groupId or cpoId gets a rotating palette entry
                  // Avoid: green/emerald (from-CPO tag), amber/yellow (edited tag), blue/sky (CPO badge)
                  const COLOR_PALETTE = [
                    { hdr: "bg-violet-100/70 dark:bg-violet-900/25", row: "bg-violet-50/40 dark:bg-violet-900/10", border: "border-l-4 border-l-violet-400 dark:border-l-violet-500", text: "text-violet-700 dark:text-violet-300" },
                    { hdr: "bg-indigo-100/70 dark:bg-indigo-900/25", row: "bg-indigo-50/40 dark:bg-indigo-900/10", border: "border-l-4 border-l-indigo-400 dark:border-l-indigo-500", text: "text-indigo-700 dark:text-indigo-300" },
                    { hdr: "bg-rose-100/70 dark:bg-rose-900/25", row: "bg-rose-50/40 dark:bg-rose-900/10", border: "border-l-4 border-l-rose-400 dark:border-l-rose-500", text: "text-rose-700 dark:text-rose-300" },
                    { hdr: "bg-fuchsia-100/70 dark:bg-fuchsia-900/25", row: "bg-fuchsia-50/40 dark:bg-fuchsia-900/10", border: "border-l-4 border-l-fuchsia-400 dark:border-l-fuchsia-500", text: "text-fuchsia-700 dark:text-fuchsia-300" },
                    { hdr: "bg-orange-100/70 dark:bg-orange-900/25", row: "bg-orange-50/40 dark:bg-orange-900/10", border: "border-l-4 border-l-orange-400 dark:border-l-orange-500", text: "text-orange-700 dark:text-orange-300" },
                    { hdr: "bg-teal-100/70 dark:bg-teal-900/25", row: "bg-teal-50/40 dark:bg-teal-900/10", border: "border-l-4 border-l-teal-400 dark:border-l-teal-500", text: "text-teal-700 dark:text-teal-300" },
                  ];
                  // Hash the key to a stable palette index so drag-and-drop reordering never changes a row's color
                  const stableColorIdx = (key: string) => {
                    let h = 0;
                    for (let i = 0; i < key.length; i++) { h = Math.imul(31, h) + key.charCodeAt(i) | 0; }
                    return Math.abs(h) % COLOR_PALETTE.length;
                  };
                  // For urgent/proforma SO: palette by first-appearance order of linkedQuotations (avoids hash collisions)
                  const getColor = (it: LineItem) => {
                    if (soType !== "standard") {
                      const qtId = it.sourceQuotationId || null;
                      if (!qtId) return null;
                      const idx = linkedQuotations.findIndex((q) => q.id === qtId);
                      return idx >= 0 ? COLOR_PALETTE[idx % COLOR_PALETTE.length] : null;
                    }
                    const key = it.setGroupId || it.sourceCustomerPoId || it.sourceQuotationId;
                    return key ? COLOR_PALETTE[stableColorIdx(key)] : null;
                  };
                  // For urgent/proforma SO: sort by quotation (first-appearance order), then by setGroupId within each quotation
                  const renderItems = soType !== "standard" ? (() => {
                    const seenQtIds = new Set<string>();
                    const qtOrder: string[] = [];
                    for (const it of items) {
                      const qtId = it.sourceQuotationId || "__none__";
                      if (!seenQtIds.has(qtId)) { seenQtIds.add(qtId); qtOrder.push(qtId); }
                    }
                    return qtOrder.flatMap((qtId) => {
                      const qtItems = items.filter((i) => (i.sourceQuotationId || "__none__") === qtId);
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
                  return renderItems.flatMap((item, rowIdx) => {
                  const rows: React.JSX.Element[] = [];
                  const color = getColor(item);
                  // Urgent/proforma SO: customer/org section header when linked quotation changes
                  if (soType !== "standard" && item.sourceQuotationId !== lastQtId) {
                    lastQtId = item.sourceQuotationId;
                    const qt = linkedQuotations.find((q) => q.id === item.sourceQuotationId);
                    const snap = qt?.customerSnapshot;
                    if (snap) {
                      const custDisplayName = [snap.title, snap.name].filter(Boolean).join(" ");
                      const orgName = (snap as any).organizationName ?? null;
                      rows.push(
                        <tr key={`qt-section-${item.sourceQuotationId ?? "none"}-${rowIdx}`}>
                          <td colSpan={colCount} className={rowIdx === 0 ? "pb-1" : "pt-4 pb-1"}>
                            <div className={`flex items-center gap-2 ${rowIdx > 0 ? "border-t border-border/60 pt-2" : ""}`}>
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md font-mono text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800">{soType === "urgent" ? "CPO To Follow" : "Pro-forma"}</span>
                              <span className="text-[10px] font-semibold text-foreground">{custDisplayName}</span>
                              {orgName && <span className="text-[10px] text-muted-foreground">{orgName}</span>}
                            </div>
                          </td>
                        </tr>,
                      );
                    }
                  }
                  // CPO group header: insert when CPO changes and multiple CPOs are linked
                  if (linkedCpos.length > 1 && item.sourceCustomerPoId !== lastCpoId) {
                    lastCpoId = item.sourceCustomerPoId;
                    const cpo = item.sourceCustomerPoId ? linkedCpos.find((c) => c.id === item.sourceCustomerPoId) : undefined;
                    const cpoCustomer = cpo?.customerSnapshot ? [cpo.customerSnapshot.title, cpo.customerSnapshot.name].filter(Boolean).join(" ") : null;
                    rows.push(
                      <tr key={`cpo-section-${item.sourceCustomerPoId ?? "none"}-${rowIdx}`}>
                        <td colSpan={colCount} className={`pt-4 pb-1 ${rowIdx === 0 ? "pt-1" : ""}`}>
                          <div className={`flex items-center gap-2 border-t border-border/60 pt-2 ${rowIdx === 0 ? "border-t-0 pt-0" : ""}`}>
                            {cpo ? (
                              <>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md font-mono ${color?.text ?? "text-muted-foreground"} ${color?.hdr ?? "bg-muted/50"} border border-current/20`}>
                                  {cpo.customerPoNo}
                                </span>
                                {cpoCustomer && <span className="text-[10px] text-muted-foreground">{cpoCustomer}</span>}
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
                    const cpoKey = soType !== "standard"
                      ? (item.sourceQuotationId ?? "__global__")
                      : (item.sourceCustomerPoId ?? "__global__");
                    const sectionHasGroups = soType !== "standard"
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
                    const setQtyNum = parseFloat(item.setQty || "1") || 1;
                    const perSetTotal = groupItems.reduce((s, i) => s + parseFloat(i.totalPrice ?? "0"), 0);
                    const groupTotal = perSetTotal * setQtyNum;
                    const perSetPrice = perSetTotal / setQtyNum;
                    rows.push(
                      <tr key={`grp-${item.setGroupId}`} className={`${color?.hdr ?? "bg-muted/40"} border-b border-border/40`}>
                        <td colSpan={colCount} className={`px-2 py-1.5 ${color?.border ?? ""}`}>
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-bold tracking-tight ${color?.text ?? "text-foreground"}`}>{item.setGroupLabel || "Set"}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${color?.text ?? "text-muted-foreground"} border-current/30 bg-white/40 dark:bg-black/20`}>
                              × {item.setQty || "1"} sets
                            </span>
                            {soType !== "proforma" && perSetTotal > 0 && (
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
                  const sourceQt = item.sourceQuotationId
                    ? linkedQuotations.find((q) => q.id === item.sourceQuotationId)
                    : undefined;
                  const custName = sourceQt?.customerSnapshot
                    ? [sourceQt.customerSnapshot.title, sourceQt.customerSnapshot.name].filter(Boolean).join(" ")
                    : null;
                  const unassignedLinked = linkedQuotations.filter((q) => q.customerId || q.customerSnapshot);
                  // CPO column: find which CPO this item belongs to
                  const sourceCpo = item.sourceCustomerPoId
                    ? linkedCpos.find((c) => c.id === item.sourceCustomerPoId)
                    : undefined;
                  const cpoCustomerName = sourceCpo?.customerSnapshot
                    ? [sourceCpo.customerSnapshot.title, sourceCpo.customerSnapshot.name].filter(Boolean).join(" ")
                    : null;
                  const Tag = ({ src: rawSrc }: { src: LineItem["_codeSource"] | string | null | undefined }) => {
                    const src: Array<"cpo" | "quotation" | "user" | "so"> | null = !rawSrc ? null : Array.isArray(rawSrc) ? rawSrc : [rawSrc as "cpo" | "quotation" | "user" | "so"];
                    if (!src?.length) return null;
                    const cpoNo = item.sourceCustomerPoNo || "CPO";
                    return (
                      <>
                        {src.includes("quotation") && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                            <LinkIcon className="w-3 h-3 shrink-0" />from quotation
                          </span>
                        )}
                        {src.includes("cpo") && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                            <LinkIcon className="w-3 h-3 shrink-0" />from {cpoNo}
                          </span>
                        )}
                        {src.includes("user") && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                            <PencilIcon className="w-3 h-3 shrink-0" />{item._editedBy || currentUserName || "user"} edited CPO
                          </span>
                        )}
                        {src.includes("so") && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800">
                            <PencilIcon className="w-3 h-3 shrink-0" />{item._soEditedBy || currentUserName || "user"} edited SO
                          </span>
                        )}
                      </>
                    );
                  };
                  const itemRow = (
                  <tr
                    key={item._key}
                    data-key={item._key}
                    className={`border-b border-border/50 last:border-0 ${isDragging ? "" : "transition-colors"} ${dragOverKey === item._key ? "border-t-2 border-t-primary" : ""} ${color ? color.row : "bg-background"} ${isDragging && dragKey.current === item._key ? "outline outline-2 outline-primary/40 outline-offset-[-1px]" : ""} ${item._isAdditional ? "text-red-500 dark:text-red-400" : ""}`}
                  >
                    <td className={`py-1.5 pr-2 align-top ${item._isAdditional ? "text-red-500 dark:text-red-400" : "text-muted-foreground"} ${color?.border ?? ""}`}><div className="h-7 flex items-center">{item.rowNo}</div></td>
                    <td className="py-1.5 pr-2 align-top">
                      <ProductCell
                        item={item}
                        rowIdx={rowIdx}
                        onUpdate={(key, patch) => updateItem(key, patch)}
                        onBlur={(key, code, prevCode) => {
                          if (code.trim() !== prevCode.trim()) {
                            const prev = items.find(i => i._key === key);
                            updateItem(key, {
                              _codeSource: [...new Set([...(prev?._codeSource ?? []).filter(s => s !== "quotation"), "so" as const])],
                              _soEditedBy: currentUserName || "user",
                            });
                          }
                          handleProductCodeBlur(key, code, prevCode);
                        }}
                        onCellKeyDown={handleCellKeyDown}
                      />
                      <Tag src={item._codeSource} />
                      {showSourcing && item.productCode?.trim() && (
                        item.sourcingType ? (
                          <button
                            type="button"
                            onClick={() => updateItem(item._key, { sourcingType: item.sourcingType === "trading" ? "oem" : "trading" })}
                            className={cn(
                              "mt-0.5 block text-[10px] px-1.5 py-0.5 rounded-md border font-medium",
                              item.sourcingType === "oem"
                                ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800"
                                : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
                            )}
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
                              onClick={() => updateItem(item._key, { sourcingType: "oem" })}
                              className="text-[10px] px-1.5 py-0.5 rounded-md border border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                            >
                              OEM
                            </button>
                          </div>
                        )
                      )}
                    </td>
                    <td className="py-1.5 pr-2 align-top">
                      <Input
                        data-row={rowIdx} data-col={1}
                        value={item.description ?? ""}
                        onChange={(e) => updateItem(item._key, {
                          description: e.target.value,
                          _descriptionSource: [...new Set([...(item._descriptionSource ?? []).filter(s => s !== "quote" && s !== "catalog"), "so"])] as Array<"quote" | "catalog" | "user" | "cpo" | "so">,
                          _soEditedBy: currentUserName || "user",
                        })}
                        onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 1)}
                        className="h-7 text-[11px] md:text-[11px]"
                      />
                      {item._isAdditional && (
                        <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                          <PlusIcon className="w-3 h-3 shrink-0" />additional row
                        </span>
                      )}
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
                      {(item._descriptionSource ?? []).includes("cpo") && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
                          <FileTextIcon className="w-3 h-3 shrink-0" />from CPO
                        </span>
                      )}
                      {(item._descriptionSource ?? []).includes("user") && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                          <PencilIcon className="w-3 h-3 shrink-0" />{item._editedBy || currentUserName || "user"} edited CPO
                        </span>
                      )}
                      {(item._descriptionSource ?? []).includes("so") && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800">
                          <PencilIcon className="w-3 h-3 shrink-0" />{item._soEditedBy || currentUserName || "user"} edited SO
                        </span>
                      )}
                      {soType === "urgent" && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[9px] text-muted-foreground">Set:</span>
                          <input
                            value={item.setGroupLabel}
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
                      <Input
                        data-row={rowIdx} data-col={2}
                        value={item.qty}
                        onChange={(e) => updateItem(item._key, {
                          qty: e.target.value,
                          _qtySource: [...new Set([...(item._qtySource ?? []).filter(s => s !== "quotation"), "so" as const])],
                          _soEditedBy: currentUserName || "user",
                        })}
                        onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 2)}
                        className="h-7 text-[11px] md:text-[11px] text-right tabular-nums"
                      />
                      <Tag src={item._qtySource} />
                    </td>
                    {soType !== "proforma" && (
                      <td className="py-1.5 pr-2 align-top">
                        <div className={`h-7 flex items-center justify-center font-mono tabular-nums text-[11px] ${item._isAdditional ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>
                          {(() => { const s = parseFloat(item.setQty || "0") || 1; const q = parseFloat(item.qty || "0"); return s > 1 ? (q * s).toLocaleString("en-MY") : q.toLocaleString("en-MY"); })()}
                        </div>
                      </td>
                    )}
                    <td className="py-1.5 pr-2 align-top">
                      <div className={`h-7 flex items-center text-[11px] px-1 ${item._isAdditional ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>{item.uom || "—"}</div>
                    </td>
                    {soType !== "proforma" && (
                      <td className="py-1.5 pr-2 align-top">
                        <div className={`h-7 flex items-center justify-end text-[11px] font-mono tabular-nums px-1 ${item._isAdditional ? "text-red-500 dark:text-red-400" : "text-foreground"}`}>{fmt(parseFloat(item.unitPrice ?? "0"))}</div>
                        <Tag src={item._unitPriceSource} />
                      </td>
                    )}
                    {soType !== "proforma" && (
                      <td className="py-1.5 pr-2 align-top">
                        <div className={`h-7 flex items-center justify-end font-mono tabular-nums text-[11px] ${item._isAdditional ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>
                          {(() => { const s = parseFloat(item.setQty || "0") || 1; const q = parseFloat(item.qty || "0"); const u = parseFloat(item.unitPrice || "0"); return fmt(q * s * u); })()}
                        </div>
                      </td>
                    )}
                    {hasQuotationCustomers && (
                      <td className="py-1.5 pr-2">
                        {custName ? (
                          <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground max-w-25 truncate" title={custName}>
                            {custName}
                          </span>
                        ) : unassignedLinked.length > 0 ? (
                          <select
                            value={item.sourceQuotationId ?? ""}
                            onChange={(e) => updateItem(item._key, { sourceQuotationId: e.target.value })}
                            className="h-6 rounded border border-border bg-background px-1 text-[10px] max-w-25"
                          >
                            <option value="">—</option>
                            {unassignedLinked.map((q) => {
                              const n = q.customerSnapshot
                                ? [q.customerSnapshot.title, q.customerSnapshot.name].filter(Boolean).join(" ")
                                : q.quotationNo;
                              return <option key={q.id} value={q.id}>{n}</option>;
                            })}
                          </select>
                        ) : null}
                      </td>
                    )}
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
                  rows.push(itemRow);
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
                const target = tableRef.current?.querySelector<HTMLInputElement>(`[data-row="${newRowIdx}"][data-col="0"]`);
                if (target) { target.focus(); target.select(); }
              }, 0);
            }}
            className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" /> Add row
          </button>
        </section>

        {/* ── 5. Pricing summary ── */}
        {soType !== "proforma" && <section className="border border-border rounded-xl p-4">
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
                  <Input
                    value={overallDiscPct}
                    onChange={(e) => setOverallDiscPct(e.target.value)}
                    className="h-7 w-16 text-xs text-right"
                  />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
                <span className="tabular-nums font-mono text-muted-foreground">−{fmt(overallDiscAmt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground shrink-0">SST</span>
                <div className="flex items-center gap-1">
                  <Input
                    value={sstPct}
                    onChange={(e) => setSstPct(e.target.value)}
                    className="h-7 w-16 text-xs text-right"
                  />
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
        </section>}

        {/* ── Actions ── */}
        <div className="flex gap-3 pb-8">
          <Button onClick={handleSaveAndSubmit} disabled={saving} className="gap-2">
            {saving ? "Creating…" : "Create & Submit"}
          </Button>
          <Button variant="outline" onClick={handleSave} disabled={saving}>
            Save as Draft
          </Button>
          <Button variant="outline" onClick={() => router.push("/dashboard/sales/order")}>
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
