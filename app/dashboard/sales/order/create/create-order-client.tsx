"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createSalesOrder,
  getNextCashSaleNo,
  submitSalesOrder,
  searchConfirmedSalesOrders,
  type SalesOrderItemInput,
} from "@/server/sales-order";
import { searchProducts, getProductsByCode } from "@/server/inventory";
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
  ChevronDownIcon,
} from "lucide-react";
import type { CustomerPoForSoCreate } from "@/server/customer-purchase-order";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];

type LinkedQuotation = {
  id: string;
  quotationNo: string;
  customerId?: string | null;
  customerSnapshot?: {
    title?: string;
    name: string;
    organizationName?: string;
  } | null;
};

type LinkedCpo = {
  id: string;
  customerPoNo: string;
  customerId: string | null;
  customerSnapshot: {
    title?: string; name: string; organizationName?: string;
    organizationAddress?: string; email?: string; contactNo?: string;
  } | null;
};

interface LineItem extends SalesOrderItemInput {
  _key: string;
  lineType: "sell" | "rent";
  rentalDuration: string;
  rentalUnit: string;
  setGroupId: string;
  setGroupLabel: string;
  setQty: string;
  sourceQuotationId: string;
  sourceCustomerPoId: string;
  sourceCustomerPoNo: string;
}

const newLine = (rowNo: number): LineItem => ({
  _key: crypto.randomUUID(),
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
  setGroupId: "",
  setGroupLabel: "",
  setQty: "",
  sourceQuotationId: "",
  sourceCustomerPoId: "",
  sourceCustomerPoNo: "",
});

interface ProductCellProps {
  item: LineItem;
  rowIdx: number;
  onUpdate: (key: string, patch: Partial<LineItem>) => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => void;
}

function ProductCell({ item, rowIdx, onUpdate, onCellKeyDown }: ProductCellProps) {
  const [q, setQ] = useState(item.productCode ?? "");
  const [results, setResults] = useState<{ id: string; productCode: string; description: string | null; uom: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setQ(item.productCode ?? ""); }, [item.productCode]);

  function handleInput(val: string) {
    setQ(val);
    onUpdate(item._key, { productCode: val, productId: undefined });
    if (debounce.current) clearTimeout(debounce.current);
    if (!val.trim()) { setResults([]); setOpen(false); return; }
    debounce.current = setTimeout(async () => {
      const r = await searchProducts(val);
      setResults(r);
      setOpen(r.length > 0);
      const exact = r.find((p) => p.productCode.toLowerCase() === val.trim().toLowerCase());
      if (exact) {
        onUpdate(item._key, {
          productId: exact.id,
          productCode: exact.productCode,
          description: item.description || exact.description || "",
          uom: item.uom || exact.uom || "",
        });
        setOpen(false);
      }
    }, 300);
  }

  function pick(p: { id: string; productCode: string; description: string | null; uom: string | null }) {
    onUpdate(item._key, {
      productId: p.id,
      productCode: p.productCode,
      description: item.description || p.description || "",
      uom: item.uom || p.uom || "",
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
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-7 text-xs"
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
  openCpos?: CustomerPoSearchResult[];
}

export function CreateSalesOrderClient({ members, cpo, openCpos = [] }: Props) {
  const router = useRouter();

  // Customer PO combobox
  const [linkedCpos, setLinkedCpos] = useState<LinkedCpo[]>([]);
  const [cpoSearch, setCpoSearch] = useState("");
  const [cpoResults, setCpoResults] = useState<CustomerPoSearchResult[]>([]);
  const [cpoHighlight, setCpoHighlight] = useState(-1);
  const [cpoLoading, setCpoLoading] = useState(false);
  const [cpoDropdownOpen, setCpoDropdownOpen] = useState(false);
  const [cashSaleLoading, setCashSaleLoading] = useState(false);
  const cpoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cpoDropdownRef = useRef<HTMLDivElement>(null);

  // Quotation search (optional)
  const [showQtSection, setShowQtSection] = useState(false);
  const [qtSearch, setQtSearch] = useState("");
  const [qtResults, setQtResults] = useState<Awaited<ReturnType<typeof searchQuotationsByNo>>>([]);
  const [qtHighlight, setQtHighlight] = useState(-1);
  const [linkedQuotations, setLinkedQuotations] = useState<LinkedQuotation[]>([]);
  const [qtLoading, setQtLoading] = useState(false);
  const [includeDummy, setIncludeDummy] = useState(false);
  const qtTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Customer
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [custOrgMemberId, setCustOrgMemberId] = useState<string | undefined>();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Header
  const [salesPerson, setSalesPerson] = useState("");
  const [associateSalesPersons, setAssociateSalesPersons] = useState<{ id: string; name: string }[]>([]);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");

  // Order type
  const [soType, setSoType] = useState<"standard" | "proforma">("standard");
  const [proformaReason, setProformaReason] = useState<"sample" | "warranty" | "replacement">("sample");
  const [originalSoSearch, setOriginalSoSearch] = useState("");
  const [originalSoResults, setOriginalSoResults] = useState<Awaited<ReturnType<typeof searchConfirmedSalesOrders>>>([]);
  const [originalSoSearching, setOriginalSoSearching] = useState(false);
  const [selectedOriginalSo, setSelectedOriginalSo] = useState<{ id: string; soNo: string } | null>(null);
  const originalSoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pricing
  const [sstPct, setSstPct] = useState("0");
  const [overallDiscPct, setOverallDiscPct] = useState("0");

  // Items
  const [items, setItems] = useState<LineItem[]>([newLine(1)]);

  const [saving, setSaving] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  // ── Pre-select CPO from prop on mount ───────────────────────────────────────
  useEffect(() => {
    if (!cpo) return;
    const linked: LinkedCpo = {
      id: cpo.id,
      customerPoNo: cpo.customerPoNo,
      customerId: cpo.customerId,
      customerSnapshot: cpo.customerSnapshot,
    };
    setLinkedCpos([linked]);
    // Import items from CPO, resolve productId by code, tag with source CPO
    if (cpo.items && cpo.items.length > 0) {
      const codes = cpo.items.map((i) => i.productCode).filter(Boolean) as string[];
      getProductsByCode(codes).then((resolved) => {
        const codeMap = new Map(resolved.map((p) => [p.productCode, p.id]));
        setItems(
          cpo.items!.map((item, idx) =>
            calcLine({
              _key: crypto.randomUUID(),
              rowNo: idx + 1,
              productId: item.productCode ? codeMap.get(item.productCode) : undefined,
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
              setGroupId: "",
              setGroupLabel: "",
              setQty: "",
              sourceQuotationId: "",
              sourceCustomerPoId: cpo.id,
              sourceCustomerPoNo: cpo.customerPoNo,
            }),
          ),
        );
      }).catch(() => {/* items load without productId — user can correct manually */});
    }
    // Auto-fill customer from CPO
    if (cpo.customerId) {
      getCustomer(cpo.customerId)
        .then((cust) => {
          if (!cust) return;
          setSelectedCustomer(cust as unknown as Customer);
          const primary = cust.memberships.find((c) => c.isPrimary) ?? cust.memberships[0];
          if (primary) setCustOrgMemberId(primary.id);
        })
        .catch(() => {
          const snap = cpo.customerSnapshot;
          if (!snap) return;
          setSelectedCustomer({
            id: cpo.customerId!,
            title: snap.title ?? null,
            name: snap.name ?? "",
            contactNo: snap.contactNo ?? null,
            email: snap.email ?? null,
            createdAt: new Date(),
            createdByName: null,
            companies: snap.organizationName
              ? [{ id: "__snap__", customerId: cpo.customerId!, organizationName: snap.organizationName, organizationAddress: snap.organizationAddress ?? null, isPrimary: true, createdAt: new Date() }]
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

      const linked: LinkedCpo = {
        id: data.id,
        customerPoNo: data.customerPoNo,
        customerId: data.customerId,
        customerSnapshot: data.customerSnapshot,
      };
      setLinkedCpos((prev) => [...prev, linked]);

      // Import CPO items (append), resolve productId by code, tag with source CPO
      if (data.items && data.items.length > 0) {
        const codes = data.items.map((i) => i.productCode).filter(Boolean) as string[];
        getProductsByCode(codes)
          .catch(() => [] as { productCode: string; id: string }[])
          .then((resolved) => {
            const codeMap = new Map(resolved.map((p) => [p.productCode, p.id]));
            setItems((prev) => {
              const base = prev.filter((i) => i.description || i.productCode);
              const newItems = (data.items ?? []).map((item) =>
                calcLine({
                  _key: crypto.randomUUID(),
                  rowNo: 0,
                  productId: item.productCode ? codeMap.get(item.productCode) : undefined,
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
                  setGroupId: "",
                  setGroupLabel: "",
                  setQty: "",
                  sourceQuotationId: "",
                  sourceCustomerPoId: data.id,
                  sourceCustomerPoNo: data.customerPoNo,
                }),
              );
              return [...base, ...newItems].map((i, idx) => ({ ...i, rowNo: idx + 1 }));
            });
          });
      }

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
    setLinkedCpos((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        setSelectedCustomer(null);
        setCustOrgMemberId(undefined);
      }
      return next;
    });
    setItems((prev) => {
      const remaining = prev
        .filter((i) => i.sourceCustomerPoId !== id)
        .map((i, idx) => ({ ...i, rowNo: idx + 1 }));
      return remaining.length > 0 ? remaining : [newLine(1)];
    });
  }

  async function handleCashSale() {
    if (cashSaleLoading) return;
    setCashSaleLoading(true);
    try {
      const no = await getNextCashSaleNo();
      setLinkedCpos((prev) => [
        ...prev,
        { id: `__cash_sale__${no}`, customerPoNo: no, customerId: null, customerSnapshot: null },
      ]);
      setCpoDropdownOpen(false);
    } catch {
      toast.error("Failed to generate cash sale number");
    } finally {
      setCashSaleLoading(false);
    }
  }

  // ── Quotation search ────────────────────────────────────────────────────────

  const handleQtSearch = useCallback((val: string, withDummy = includeDummy) => {
    setQtSearch(val);
    setQtHighlight(-1);
    if (val.length < 2) { setQtResults([]); return; }
    if (qtTimer.current) clearTimeout(qtTimer.current);
    qtTimer.current = setTimeout(async () => {
      const res = await searchQuotationsByNo(val, withDummy);
      setQtResults(res);
      setQtHighlight(-1);
    }, 300);
  }, [includeDummy]);

  function handleToggleDummy() {
    const next = !includeDummy;
    setIncludeDummy(next);
    if (qtSearch.length >= 2) handleQtSearch(qtSearch, next);
  }

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
      }]);

      // Append items (renumber after existing), tag with source quotation
      const newItems = qt.items.map((item) =>
        calcLine({
          _key: crypto.randomUUID(),
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
        if (qt.salesPersonName) setSalesPerson(qt.salesPersonName);
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
    } catch {
      toast.error("Failed to load quotation");
    } finally {
      setQtLoading(false);
    }
  }

  function removeLinkedQuotation(id: string) {
    setLinkedQuotations((prev) => prev.filter((q) => q.id !== id));
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

  // ── Cell keyboard navigation ────────────────────────────────────────────────

  function handleCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    colIdx: number,
  ) {
    const el = e.currentTarget;
    const COLS = soType === "proforma" ? 4 : 6;

    const focus = (r: number, c: number) => {
      const target = tableRef.current?.querySelector<HTMLInputElement>(
        `[data-row="${r}"][data-col="${c}"]`,
      );
      if (target) { target.focus(); target.select(); }
    };

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focus(rowIdx + 1, colIdx);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (rowIdx > 0) focus(rowIdx - 1, colIdx);
        break;
      case "Enter":
        e.preventDefault();
        if (rowIdx < items.length - 1) {
          focus(rowIdx + 1, colIdx);
        } else {
          addLine();
          setTimeout(() => focus(rowIdx + 1, colIdx), 0);
        }
        break;
      case "ArrowRight":
        if (el.selectionStart === el.value.length) {
          e.preventDefault();
          if (colIdx < COLS - 1) focus(rowIdx, colIdx + 1);
          else focus(rowIdx + 1, 0);
        }
        break;
      case "ArrowLeft":
        if (el.selectionStart === 0) {
          e.preventDefault();
          if (colIdx > 0) focus(rowIdx, colIdx - 1);
          else if (rowIdx > 0) focus(rowIdx - 1, COLS - 1);
        }
        break;
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function buildAndCreate() {
    const primaryCustomerId = selectedCustomer?.id
      ?? linkedCpos.find((c) => c.customerId)?.customerId
      ?? linkedQuotations.find((q) => q.customerId)?.customerId
      ?? null;
    if (!primaryCustomerId) { toast.error("Please select a customer"); return null; }
    if (!items.some((i) => i.description || i.productCode)) { toast.error("Add at least one item"); return null; }

    const { subtotal, overallDiscAmt, sstAmt, grand } = soType === "proforma"
      ? { subtotal: 0, overallDiscAmt: 0, sstAmt: 0, grand: 0 }
      : calcTotals(items, sstPct, overallDiscPct);
    return createSalesOrder({
      soType,
      proformaReason: soType === "proforma" ? proformaReason : undefined,
      originalSoId: soType === "proforma" && selectedOriginalSo ? selectedOriginalSo.id : undefined,
      originalSoNo: soType === "proforma" && selectedOriginalSo ? selectedOriginalSo.soNo : undefined,
      customerId: primaryCustomerId,
      customerOrgMemberId: selectedCustomer ? custOrgMemberId : undefined,
      customerPoLinks: linkedCpos.length > 0
        ? linkedCpos.map((c) => ({
            // Cash-sale virtual CPOs have no real CPO record; send empty string
            // so the server stores the reference number without a FK lookup.
            customerPoId: c.id.startsWith("__cash_sale__") ? "" : c.id,
            customerPoNo: c.customerPoNo,
          }))
        : undefined,
      linkedQuotations: linkedQuotations.length > 0 ? linkedQuotations : undefined,
      salesPersonName: salesPerson || undefined,
      associateSalesPersons: associateSalesPersons.length > 0 ? associateSalesPersons : undefined,
      deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
      deliveryAddress: deliveryAddress || undefined,
      notes: notes || undefined,
      subtotal: subtotal.toFixed(2),
      overallDiscountPct: overallDiscPct,
      overallDiscountAmt: overallDiscAmt.toFixed(2),
      sstPct,
      sst: sstAmt.toFixed(2),
      grandTotal: grand.toFixed(2),
      items: items.map(({ _key, lineType, rentalDuration, rentalUnit, setGroupId, setGroupLabel, setQty, sourceQuotationId, sourceCustomerPoId, sourceCustomerPoNo, ...rest }) => ({
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
          <div className="flex gap-2">
            {(["standard", "proforma"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSoType(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  soType === t
                    ? t === "proforma"
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/40"
                }`}
              >
                {t === "standard" ? "Standard" : "Pro-forma"}
              </button>
            ))}
          </div>
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
                    <div className="relative">
                      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        value={originalSoSearch}
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

        {/* ── 1. Linked Customer POs — combobox ── */}
        {soType !== "proforma" && <section className={`border rounded-xl p-4 ${linkedQuotations.length > 0 ? "border-border/40 opacity-50 pointer-events-none" : "border-border"}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Customer POs</h2>
            {linkedQuotations.length > 0 && (
              <span className="text-[11px] text-muted-foreground">Remove quotation first</span>
            )}
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
                const isCashSale = c.id.startsWith("__cash_sale__");
                return (
                  <span
                    key={c.id}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-mono leading-5 ${
                      isCashSale
                        ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300"
                        : "bg-muted border border-border/60"
                    }`}
                  >
                    {c.customerPoNo}
                    {custName && <span className="text-[10px] text-muted-foreground font-sans hidden sm:inline">{custName}</span>}
                    <button
                      className="text-muted-foreground hover:text-foreground -mr-0.5"
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
                {/* Cash Sale — always visible at the bottom of the dropdown */}
                <div className="border-t border-border/60">
                  <button
                    type="button"
                    disabled={cashSaleLoading}
                    onClick={handleCashSale}
                    className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors disabled:opacity-50"
                  >
                    {cashSaleLoading
                      ? <span className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin shrink-0" />
                      : <PlusIcon className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />}
                    <span className="text-sm text-emerald-700 dark:text-emerald-300 font-medium">Cash Sale</span>
                    <span className="text-[11px] text-muted-foreground ml-1">— generates CASH-SALE-XX reference</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>}

        {/* ── 1b. Linked quotations (optional) ── */}
        {(soType !== "proforma" || proformaReason === "sample") && <section className={`border rounded-xl p-4 ${linkedCpos.length > 0 ? "border-border/40 opacity-50 pointer-events-none" : "border-border"}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Quotations <span className="text-muted-foreground font-normal text-xs">(optional)</span>
            </h2>
            {linkedCpos.length > 0 ? (
              <span className="text-[11px] text-muted-foreground">Remove customer PO first</span>
            ) : !showQtSection && (
              <button className="text-xs text-primary hover:underline flex items-center gap-1"
                onClick={() => setShowQtSection(true)}>
                <PlusIcon className="w-3 h-3" /> Link quotation
              </button>
            )}
          </div>

          {showQtSection && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {linkedQuotations.map((q) => (
                  <span key={q.id} className="flex items-center gap-1 text-[11px] bg-muted rounded-full px-2.5 py-1 font-mono">
                    <FileTextIcon className="w-3 h-3 text-muted-foreground" />
                    {q.quotationNo}
                    <button onClick={() => removeLinkedQuotation(q.id)} className="text-muted-foreground hover:text-foreground ml-0.5">
                      <XIcon className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="relative">
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
              <div className="flex items-center justify-between">
                <button type="button" onClick={handleToggleDummy}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                  <div className={`w-7 h-4 rounded-full transition-colors flex items-center px-0.5 ${includeDummy ? "bg-primary" : "bg-muted-foreground/30"}`}>
                    <div className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${includeDummy ? "translate-x-3" : "translate-x-0"}`} />
                  </div>
                  Include dummy quotations
                </button>
                <button className="text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => { setShowQtSection(false); setQtSearch(""); setQtResults([]); }}>
                  Hide
                </button>
              </div>
            </div>
          )}
        </section>}

        {/* ── 2. Customer ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">
            Customer{(linkedCustomers.length > 1 || cpoLinkedCustomers.length > 1) ? "s" : ""}
          </h2>

          {linkedCustomers.length > 0 ? (
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
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={custSearch}
                onChange={(e) => handleCustSearch(e.target.value)}
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
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Sales person</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={salesPerson}
                  onChange={(e) => setSalesPerson(e.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-2.5 text-sm shrink-0"
                >
                  <option value="">— Select —</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.name ?? m.email}>{m.name ?? m.email}</option>
                  ))}
                </select>
                {associateSalesPersons.map((a) => (
                  <span key={a.id} className="flex items-center gap-1 text-[11px] bg-muted rounded-full px-2.5 py-1 shrink-0">
                    {a.name}
                    <button
                      onClick={() => setAssociateSalesPersons((prev) => prev.filter((x) => x.id !== a.id))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <select
                  value=""
                  onChange={(e) => {
                    const m = members.find((x) => x.userId === e.target.value);
                    if (!m) return;
                    if (associateSalesPersons.some((a) => a.id === m.userId)) return;
                    setAssociateSalesPersons((prev) => [...prev, { id: m.userId, name: m.name ?? m.email }]);
                  }}
                  className="h-9 rounded-md border border-dashed border-border bg-background px-2.5 text-sm text-muted-foreground shrink-0"
                >
                  <option value="">+ Add associate…</option>
                  {members
                    .filter((m) => !associateSalesPersons.some((a) => a.id === m.userId))
                    .map((m) => (
                      <option key={m.userId} value={m.userId}>{m.name ?? m.email}</option>
                    ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Due delivery date</Label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Delivery address</Label>
              <Input
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="Address"
                className="h-9 text-sm"
              />
            </div>
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Items</h2>
            <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={addLine}>
              <PlusIcon className="w-3 h-3" /> Add row
            </Button>
          </div>

          <div className="overflow-x-auto" ref={tableRef}>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left pb-2 pr-2 w-8">#</th>
                  <th className="text-left pb-2 pr-2 w-24">Code</th>
                  <th className="text-left pb-2 pr-2">Description</th>
                  <th className="text-right pb-2 pr-2 w-16">Qty</th>
                  <th className="text-left pb-2 pr-2 w-14">UOM</th>
                  {soType !== "proforma" && <th className="text-right pb-2 pr-2 w-24">Unit price</th>}
                  {soType !== "proforma" && <th className="text-right pb-2 pr-2 w-16">Disc %</th>}
                  {soType !== "proforma" && <th className="text-right pb-2 pr-2 w-24">Total</th>}
                  {showCpoColumn && (
                    <th className="text-left pb-2 pr-2 w-28">From CPO</th>
                  )}
                  {!showCpoColumn && linkedQuotations.some((q) => q.customerId || q.customerSnapshot) && (
                    <th className="text-left pb-2 pr-2 w-28">Customer</th>
                  )}
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, rowIdx) => {
                  const hasQuotationCustomers = !showCpoColumn && linkedQuotations.some((q) => q.customerId || q.customerSnapshot);
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
                  return (
                  <tr key={item._key} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-2 text-muted-foreground">{item.rowNo}</td>
                    <td className="py-1.5 pr-2">
                      <ProductCell
                        item={item}
                        rowIdx={rowIdx}
                        onUpdate={updateItem}
                        onCellKeyDown={handleCellKeyDown}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        data-row={rowIdx} data-col={1}
                        value={item.description ?? ""}
                        onChange={(e) => updateItem(item._key, { description: e.target.value })}
                        onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 1)}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        data-row={rowIdx} data-col={2}
                        value={item.qty}
                        onChange={(e) => updateItem(item._key, { qty: e.target.value })}
                        onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 2)}
                        className="h-7 text-xs text-right"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        data-row={rowIdx} data-col={3}
                        value={item.uom ?? ""}
                        onChange={(e) => updateItem(item._key, { uom: e.target.value })}
                        onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 3)}
                        className="h-7 text-xs"
                        placeholder="unit"
                      />
                    </td>
                    {soType !== "proforma" && (
                      <td className="py-1.5 pr-2">
                        <Input
                          data-row={rowIdx} data-col={4}
                          value={item.unitPrice ?? "0"}
                          onChange={(e) => updateItem(item._key, { unitPrice: e.target.value })}
                          onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 4)}
                          className="h-7 text-xs text-right"
                        />
                      </td>
                    )}
                    {soType !== "proforma" && (
                      <td className="py-1.5 pr-2">
                        <Input
                          data-row={rowIdx} data-col={5}
                          value={item.discountPct ?? "0"}
                          onChange={(e) => updateItem(item._key, { discountPct: e.target.value })}
                          onKeyDown={(e) => handleCellKeyDown(e, rowIdx, 5)}
                          className="h-7 text-xs text-right"
                        />
                      </td>
                    )}
                    {soType !== "proforma" && (
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted-foreground">
                        {fmt(parseFloat(item.totalPrice ?? "0"))}
                      </td>
                    )}
                    {showCpoColumn && (
                      <td className="py-1.5 pr-2">
                        {sourceCpo ? (
                          <div className="space-y-0.5">
                            <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 font-mono">
                              {sourceCpo.customerPoNo}
                            </span>
                            {cpoCustomerName && (
                              <p className="text-[10px] text-muted-foreground truncate max-w-25" title={cpoCustomerName}>
                                {cpoCustomerName}
                              </p>
                            )}
                          </div>
                        ) : (
                          <select
                            value={item.sourceCustomerPoId ?? ""}
                            onChange={(e) => {
                              const cpo = linkedCpos.find((c) => c.id === e.target.value);
                              updateItem(item._key, {
                                sourceCustomerPoId: e.target.value || undefined,
                                sourceCustomerPoNo: cpo?.customerPoNo || undefined,
                              } as Partial<LineItem>);
                            }}
                            className="h-6 rounded border border-border bg-background px-1 text-[10px] max-w-27.5"
                          >
                            <option value="">— assign —</option>
                            {linkedCpos.map((c) => {
                              const snap = c.customerSnapshot;
                              const label = snap
                                ? `${c.customerPoNo} · ${[snap.title, snap.name].filter(Boolean).join(" ")}`
                                : c.customerPoNo;
                              return <option key={c.id} value={c.id}>{label}</option>;
                            })}
                          </select>
                        )}
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
                    <td className="py-1.5">
                      <button
                        onClick={() => removeLine(item._key)}
                        disabled={items.length === 1}
                        className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
    </div>
  );
}
