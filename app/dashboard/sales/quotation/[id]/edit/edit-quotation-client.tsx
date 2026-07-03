"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  updateQuotation,
  getQuotationDetail,
  type UpdateQuotationInput,
} from "@/server/quotation";
import { getCustomers } from "@/server/customer";
import { getOrgMembersForQuotation } from "@/server/quotation";
import { type DocumentCategoryRow } from "@/server/document-category";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  SaveIcon,
  ShieldCheckIcon,
  AlertCircleIcon,
  CheckIcon,
  LayersIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { nanoid } from "nanoid";

type Data = NonNullable<Awaited<ReturnType<typeof getQuotationDetail>>>;
type Customer = Awaited<ReturnType<typeof getCustomers>>[number];
type Member = Awaited<ReturnType<typeof getOrgMembersForQuotation>>[number];

type EditItem = UpdateQuotationInput["items"][number] & {
  _key: string;
  lineType: "sell" | "rent";
  rentalDuration: string;
  rentalUnit: string;
  setGroupId: string;
  setGroupLabel: string;
  setQty: string;
};


function Field({
  label,
  children,
  className,
  required,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="block text-xs font-medium text-muted-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="px-4 py-2.5 bg-muted/20 border-b border-border">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </span>
    </div>
  );
}

function OptionToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-2 text-xs"
      onClick={() => onChange(!checked)}
    >
      <div
        className={cn(
          "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
          checked ? "bg-primary border-primary" : "border-border bg-muted/30",
        )}
      >
        {checked && <CheckIcon className="w-2.5 h-2.5 text-primary-foreground" />}
      </div>
      <span className={checked ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
    </button>
  );
}

interface Props {
  data: Data;
  initialCustomer: Customer | null;
  members: Member[];
  categories: DocumentCategoryRow[];
}

export function EditQuotationClient({ data, initialCustomer, members, categories }: Props) {
  const router = useRouter();
  const { quotation: q, items: existingItems } = data;

  // ── Header state ────────────────────────────────────────────────────────
  const [title, setTitle] = useState(q.title ?? "Loose Items");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(() => initialCustomer ?? null);
  const customerId = selectedCustomer?.id ?? q.customerId ?? "";
  const [customerOrgMemberId, setCustomerOrgMemberId] = useState(() => {
    const cust = initialCustomer;
    if (!cust) return "";
    const snapshotOrg = (q.customerSnapshot as { organizationName?: string } | null)?.organizationName;
    if (snapshotOrg) {
      const match = cust.memberships.find((co) => co.orgName === snapshotOrg);
      if (match) return match.id;
    }
    return cust.memberships.find((co) => co.isPrimary)?.id ?? cust.memberships[0]?.id ?? "";
  });
  const [customerSearch, setCustomerSearch] = useState(() => {
    if (!initialCustomer) return "";
    return [initialCustomer.title, initialCustomer.name].filter(Boolean).join(" ");
  });
  const [customerOpen, setCustomerOpen] = useState(false);
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const custSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customerBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spInputRef = useRef<HTMLInputElement>(null);
  const [salesPersons, setSalesPersons] = useState<{ id: string; name: string; isExt: boolean }[]>(() => {
    const list: { id: string; name: string; isExt: boolean }[] = [];
    if (q.salesPersonName) {
      list.push({ id: q.salesPersonId ?? `mem-${q.salesPersonName}`, name: q.salesPersonName, isExt: !q.salesPersonId });
    }
    (q.associateSalesPersons ?? []).forEach((a) => list.push({ id: a.id, name: a.name, isExt: true }));
    return list;
  });
  const [spInput, setSpInput] = useState("");
  const [validDays, setValidDays] = useState(() => {
    if (!q.validUntil) return "90";
    const base = q.createdAt ? new Date(q.createdAt).getTime() : Date.now();
    const diff = Math.round((new Date(q.validUntil).getTime() - base) / 86400000);
    return String(Math.max(1, diff));
  });
  const [categoryIds, setCategoryIds] = useState<string[]>((q.categoryIds as string[]) ?? []);
  const [notes, setNotes] = useState(q.notes ?? "");
  const [deliveryTerm, setDeliveryTerm] = useState(q.deliveryTerm ?? "EX-STOCK SUBJECT PRIOR SALES, OTHERWISE 8 – 12 WEEKS");
  const [paymentTerm, setPaymentTerm] = useState(q.paymentTerm ?? "30 days");
  const [returnPolicy, setReturnPolicy] = useState(q.returnPolicy ?? "GOODS ONCE SOLD WILL NOT TAKEN BACK");
  const [warranty, setWarranty] = useState((q as any).warranty ?? "5 years against material and manufacturing defects");

  // ── Items state ─────────────────────────────────────────────────────────
  const [items, setItems] = useState<EditItem[]>(() =>
    existingItems.map((it) => ({
      _key: nanoid(),
      rowNo: it.rowNo,
      sku: it.sku,
      productCode: it.productCode,
      description: it.description,
      qty: it.qty,
      uom: it.uom,
      unitPrice: it.unitPrice ?? "0",
      discountPct: it.discountPct ?? "0",
      productId: it.productId,
      productName: it.productName,
      imageKey: it.imageKey,
      mdaRegNo: it.mdaRegNo,
      mdaValidity: it.mdaValidity,
      hasCert: !!it.hasCert,
      hasPrice: !!it.hasPrice,
      descriptionSource: (it.descriptionSource as "db" | "sheet") ?? "db",
      priceSource: (it.priceSource as "db" | "sheet") ?? "db",
      uomSource: (it.uomSource as "db" | "sheet") ?? "db",
      lineType: (it.lineType as "sell" | "rent") ?? "sell",
      rentalDuration: it.rentalDuration ?? "",
      rentalUnit: it.rentalUnit ?? "case",
      setGroupId: it.setGroupId ?? "",
      setGroupLabel: it.setGroupLabel ?? "",
      setQty: it.setQty ?? "",
    })),
  );

  // ── Pricing state ────────────────────────────────────────────────────────
  const initDiscType: "pct" | "fixed" = Number(q.overallDiscountPct ?? 0) > 0 ? "pct"
    : Number(q.overallDiscountAmt ?? 0) > 0 ? "fixed" : "pct";
  const [discountType, setDiscountType] = useState<"pct" | "fixed">(initDiscType);
  const [overallDiscount, setOverallDiscount] = useState(
    initDiscType === "pct" ? (q.overallDiscountPct ?? "0") : "0",
  );
  const [specialDiscAmt, setSpecialDiscAmt] = useState(
    initDiscType === "fixed" ? (q.overallDiscountAmt ?? "0") : "0",
  );
  const [sstPct, setSstPct] = useState(q.sstPct ?? "0");
  const applySST = Number(sstPct) > 0;

  // ── Document options ─────────────────────────────────────────────────────
  const [includeCatalogue, setIncludeCatalogue] = useState(!!Number(q.includeCatalogue));
  const [includeMdaCerts, setIncludeMdaCerts] = useState(!!Number(q.includeMdaCerts));
  const [showProductCode, setShowProductCode] = useState(!!Number(q.showProductCode ?? 1));
  const [inclMof, setInclMof] = useState(!!Number(q.inclMof));
  const [inclSsm, setInclSsm] = useState(!!Number(q.inclSsm));
  const [inclTcc, setInclTcc] = useState(!!Number(q.inclTcc));
  const [inclBankStatement, setInclBankStatement] = useState(!!Number(q.inclBankStatement));
  const [inclMdaEstablishment, setInclMdaEstablishment] = useState(!!Number(q.inclMdaEstablishment));
  const [inclLampiran12, setInclLampiran12] = useState(!!Number(q.inclLampiran12));
  const [inclLampiran13, setInclLampiran13] = useState(!!Number(q.inclLampiran13));

  const [saving, setSaving] = useState(false);

  // ── Computed totals ──────────────────────────────────────────────────────
  const [sets, setSets] = useState(Number(q.sets ?? 1));

  function itemLineTotal(it: EditItem): number {
    const qty = Number(it.qty ?? 0);
    const price = Number(it.unitPrice ?? 0);
    const disc = Number(it.discountPct ?? 0) / 100;
    const setMul = it.setGroupId ? Number(it.setQty || 1) : 1;
    const dur = it.lineType === "rent" ? Number(it.rentalDuration || 1) : 1;
    return qty * setMul * dur * price * (1 - disc);
  }

  const subtotalPerSet = items.reduce((s, it) => s + itemLineTotal(it), 0);
  const subtotal = subtotalPerSet * sets;
  const discAmt = discountType === "pct"
    ? subtotal * (Number(overallDiscount) / 100)
    : Number(specialDiscAmt);
  const afterDiscount = subtotal - discAmt;
  const sstAmt = afterDiscount * (Number(sstPct) / 100);
  const grandTotal = afterDiscount + sstAmt;

  const fmt = (v: number) =>
    `RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

  // ── Item helpers ─────────────────────────────────────────────────────────
  const updateItem = (key: string, field: keyof EditItem, value: string) => {
    setItems((prev) =>
      prev.map((it) => (it._key === key ? { ...it, [field]: value } : it)),
    );
  };

  const removeItem = (key: string) => {
    setItems((prev) =>
      prev
        .filter((it) => it._key !== key)
        .map((it, i) => ({ ...it, rowNo: String(i + 1) })),
    );
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        _key: nanoid(),
        rowNo: String(prev.length + 1),
        qty: "1",
        unitPrice: "0",
        discountPct: "0",
        descriptionSource: "sheet",
        priceSource: "sheet",
        uomSource: "sheet",
        hasCert: false,
        hasPrice: false,
        lineType: "sell",
        rentalDuration: "",
        rentalUnit: "case",
        setGroupId: "",
        setGroupLabel: "",
        setQty: "",
      },
    ]);
  };

  // When setQty changes for one item in a group, sync it to all group members
  const updateSetQty = (groupId: string, value: string) => {
    setItems((prev) =>
      prev.map((it) => (it.setGroupId === groupId ? { ...it, setQty: value } : it)),
    );
  };

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!customerId) { toast.error("Please select a customer"); return; }
    if (salesPersons.length === 0) { toast.error("Please add at least one sales person"); return; }
    if (items.length === 0) {
      toast.error("Add at least one item");
      return;
    }
    setSaving(true);
    try {
      const payload: UpdateQuotationInput = {
        title,
        sets,
        customerId: customerId || null,
        customerOrgMemberId: customerOrgMemberId || null,
        salesPersonId: salesPersons.find((s) => !s.isExt)?.id || null,
        salesPersonName: salesPersons[0]?.name || null,
        associateSalesPersons: salesPersons.length > 1 ? salesPersons.slice(1).map(({ id, name }) => ({ id, name })) : null,
        validDays: Number(validDays) || 30,
        notes: notes || null,
        deliveryTerm: deliveryTerm || null,
        paymentTerm: paymentTerm || null,
        returnPolicy: returnPolicy || null,
        warranty: warranty || null,
        overallDiscountPct: discountType === "pct" ? overallDiscount : "0",
        overallDiscountAmt: discountType === "fixed" ? specialDiscAmt : undefined,
        sstPct: sstPct,
        includeCatalogue,
        includeMdaCerts,
        showTotalPrice: true,
        showItemizeDiscount: items.some((it) => Number(it.discountPct) > 0),
        showProductCode,
        inclMof,
        inclSsm,
        inclTcc,
        inclBankStatement,
        inclMdaEstablishment,
        inclLampiran12,
        inclLampiran13,
        categoryIds,
        items: items.map(({ _key, lineType, rentalDuration, rentalUnit, setGroupId, setGroupLabel, setQty, ...it }) => ({
          ...it,
          lineType,
          rentalDuration: rentalDuration || null,
          rentalUnit: rentalUnit || null,
          setGroupId: setGroupId || null,
          setGroupLabel: setGroupLabel || null,
          setQty: setQty || null,
        })),
      };
      await updateQuotation(q.id, payload);
      toast.success("Quotation updated");
      router.push(`/dashboard/sales/quotation/${q.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Render a single item row (used for both set-member and standalone) ─────
  const renderItemRow = (item: EditItem, inSet: boolean) => {
    const lineTotal = itemLineTotal(item);
    const isRent = item.lineType === "rent";
    return (
      <tr
        key={item._key}
        className={cn(
          "border-b border-border/60 last:border-0",
          inSet && "bg-blue-50/20 dark:bg-blue-900/5",
        )}
      >
        {/* # + type toggle */}
        <td className="px-3 py-1.5 w-12 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-muted-foreground text-[10px]">{item.rowNo}</span>
            <button
              type="button"
              onClick={() => updateItem(item._key, "lineType", isRent ? "sell" : "rent")}
              className={cn(
                "text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors",
                isRent
                  ? "bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400"
                  : "bg-green-50 border-green-300 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400",
              )}
            >
              {isRent ? "RENT" : "SELL"}
            </button>
          </div>
        </td>

        {/* Product code */}
        <td className="px-2 py-1.5 w-24">
          <input
            value={item.productCode ?? ""}
            onChange={(e) => updateItem(item._key, "productCode", e.target.value)}
            placeholder="Code"
            className="w-full h-7 border border-input rounded px-2 text-xs bg-background outline-none focus:ring-1 focus:ring-ring font-mono"
          />
        </td>

        {/* Description + rental sub-row + set assignment */}
        <td className="px-2 py-1.5 w-120">
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <input
                value={item.description ?? ""}
                onChange={(e) => updateItem(item._key, "description", e.target.value)}
                placeholder="Description"
                className="flex-1 h-7 border border-input rounded px-2 text-xs bg-background outline-none focus:ring-1 focus:ring-ring"
              />
              {item.hasCert ? (
                <ShieldCheckIcon className="w-3.5 h-3.5 text-green-500 shrink-0" />
              ) : item.productId ? (
                <AlertCircleIcon className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              ) : null}
            </div>
            {/* Rental duration row */}
            {isRent && (
              <div className="flex items-center gap-1 pl-0.5">
                <span className="text-[10px] text-amber-600 dark:text-amber-400">rental for</span>
                <input
                  type="number"
                  min="1"
                  value={item.rentalDuration}
                  onChange={(e) => updateItem(item._key, "rentalDuration", e.target.value)}
                  placeholder="0"
                  className="h-6 w-14 border border-amber-200 dark:border-amber-700 rounded px-1.5 text-xs bg-background outline-none focus:ring-1 focus:ring-amber-400 text-right"
                />
                <select
                  value={item.rentalUnit}
                  onChange={(e) => updateItem(item._key, "rentalUnit", e.target.value)}
                  className="h-6 border border-amber-200 dark:border-amber-700 rounded px-1 text-xs bg-background outline-none focus:ring-1 focus:ring-amber-400"
                >
                  {["day", "week", "month", "year", "case"].map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            )}
            {item.setGroupLabel && (
              <div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  {item.setGroupLabel}
                </span>
              </div>
            )}
          </div>
        </td>

        {/* Qty — labelled "qty/set" when in a set */}
        <td className="px-2 py-1.5 w-16">
          <div className="space-y-0.5">
            <input
              type="number"
              min="0"
              step="0.01"
              value={item.qty}
              onChange={(e) => updateItem(item._key, "qty", e.target.value)}
              className="w-full h-7 border border-input rounded px-2 text-xs bg-background outline-none focus:ring-1 focus:ring-ring text-right"
            />
            {inSet && (
              <div className="text-[9px] text-muted-foreground text-right">/set</div>
            )}
          </div>
        </td>

        {/* UOM */}
        <td className="px-2 py-1.5 w-14 text-center text-xs text-muted-foreground">
          {item.uom || "—"}
        </td>

        {/* Unit price */}
        <td className="px-2 py-1.5 w-24">
          <input
            type="number"
            min="0"
            step="0.01"
            value={item.unitPrice}
            onChange={(e) => updateItem(item._key, "unitPrice", e.target.value)}
            className="w-full h-7 border border-input rounded px-2 text-xs bg-background outline-none focus:ring-1 focus:ring-ring text-right"
          />
        </td>

        {/* Disc% */}
        <td className="px-2 py-1.5 w-16">
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={item.discountPct}
            onChange={(e) => updateItem(item._key, "discountPct", e.target.value)}
            className="w-full h-7 border border-input rounded px-2 text-xs bg-background outline-none focus:ring-1 focus:ring-ring text-right"
          />
        </td>

        {/* Total */}
        <td className="px-3 py-1.5 text-right tabular-nums font-medium w-24">
          {lineTotal.toLocaleString("en-MY", { minimumFractionDigits: 2 })}
        </td>

        {/* Delete */}
        <td className="px-2 py-1.5 w-8">
          <button
            onClick={() => removeItem(item._key)}
            className="text-muted-foreground hover:text-destructive transition-colors"
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => router.push(`/dashboard/sales/quotation/${q.id}`)}
          >
            <ArrowLeftIcon className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Edit quotation
            </h1>
            <div className="text-xs text-muted-foreground mt-0.5 font-mono">
              {q.quotationNo}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => router.push(`/dashboard/sales/quotation/${q.id}`)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <SaveIcon className="w-3.5 h-3.5" />
            )}
            Save changes
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_280px] gap-4 items-start">
        {/* Left column */}
        <div className="space-y-4">
          {/* Card 1: Customer */}
          <div className="bg-background border border-border rounded-xl">
            <div className="px-4 py-3 bg-muted/20 border-b border-border rounded-t-xl">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Customer<span className="text-destructive ml-0.5 normal-case">*</span>
              </div>
            </div>
            <div className="p-4 space-y-4">
              <Field label="Quotation title">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Loose Items"
                  className="h-9 text-sm"
                />
              </Field>

              <Field label="Number of sets">
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min="1"
                    value={sets}
                    onChange={(e) => setSets(Math.max(1, Number(e.target.value) || 1))}
                    className="h-9 text-sm w-28"
                  />
                  {sets > 1 && (
                    <span className="text-xs text-muted-foreground">
                      All item quantities × {sets} sets
                    </span>
                  )}
                </div>
              </Field>

              <div>
                {(() => {
                  const trimmed = customerSearch.trim();
                  const selectedLabel = selectedCustomer
                    ? [selectedCustomer.title, selectedCustomer.name].filter(Boolean).join(" ")
                    : "";
                  return (
                    <div className="relative">
                      <Input
                        className="h-9 text-sm"
                        placeholder={selectedLabel || "Type to search by name, contact, or hospital…"}
                        value={customerSearch}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCustomerSearch(val);
                          setCustomerOpen(true);
                          if (!val) { setSelectedCustomer(null); setCustomerOrgMemberId(""); setCustResults([]); return; }
                          if (custSearchTimer.current) clearTimeout(custSearchTimer.current);
                          custSearchTimer.current = setTimeout(async () => {
                            if (val.trim().length < 2) { setCustResults([]); return; }
                            const res = await getCustomers(val.trim());
                            setCustResults(res.slice(0, 8));
                          }, 300);
                        }}
                        onFocus={() => setCustomerOpen(true)}
                        onBlur={() => {
                          customerBlurTimer.current = setTimeout(() => setCustomerOpen(false), 150);
                        }}
                      />
                      {customerOpen && (
                        <div className="absolute z-50 w-full mt-1 bg-background border border-border rounded-md shadow-md max-h-52 overflow-y-auto">
                          {trimmed.length < 2 ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground">Type to search customers…</div>
                          ) : custResults.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground">No customers found</div>
                          ) : (
                            custResults.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  if (customerBlurTimer.current) clearTimeout(customerBlurTimer.current);
                                  const label = [c.title, c.name].filter(Boolean).join(" ");
                                  setSelectedCustomer(c);
                                  setCustomerSearch(label);
                                  setCustomerOpen(false);
                                  setCustResults([]);
                                  const primary = c.memberships.find((co) => co.isPrimary) ?? c.memberships[0];
                                  setCustomerOrgMemberId(primary?.id ?? "");
                                }}
                              >
                                <span>{[c.title, c.name].filter(Boolean).join(" ")}</span>
                                {(c.memberships.find(m => m.isPrimary) ?? c.memberships[0])?.orgName && <span className="ml-2 text-xs text-muted-foreground">{(c.memberships.find(m => m.isPrimary) ?? c.memberships[0])?.orgName}</span>}
                                {c.contactNo && <span className="ml-2 text-xs text-muted-foreground">{c.contactNo}</span>}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Hospital / organization selector */}
              {(() => {
                if (!selectedCustomer || selectedCustomer.memberships.length === 0) return null;
                const selectedCompany =
                  selectedCustomer.memberships.find((co) => co.id === customerOrgMemberId) ??
                  selectedCustomer.memberships.find((co) => co.isPrimary) ??
                  selectedCustomer.memberships[0];
                return (
                  <>
                    <Field label="Hospital / organization">
                      <Select
                        key={selectedCustomer.id}
                        onValueChange={setCustomerOrgMemberId}
                        value={customerOrgMemberId}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Select hospital" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedCustomer.memberships.map((co) => (
                            <SelectItem key={co.id} value={co.id}>
                              {co.orgName ?? "—"}
                              {co.isPrimary ? " ★" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    {selectedCompany && (
                      <div className="p-3 bg-muted/30 rounded-lg text-xs text-muted-foreground space-y-1">
                        <div>
                          {selectedCompany.position}
                          {selectedCompany.department ? ` · ${selectedCompany.department}` : ""}
                        </div>
                        <div>{selectedCompany.orgAddress}</div>
                        <div>
                          {selectedCustomer.email}
                          {selectedCustomer.contactNo ? ` · ${selectedCustomer.contactNo}` : ""}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Card 2: Sales & validity */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Sales & validity
              </div>
            </div>
            <div className="p-4 space-y-4">
              {/* Valid for */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Valid for</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="1"
                    value={validDays}
                    onChange={(e) => setValidDays(e.target.value)}
                    className="h-9 text-sm w-20 text-right"
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
              </div>
              {/* Sales person — unified tag input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Sales person<span className="text-destructive ml-0.5">*</span></label>
                <div
                  className="min-h-9 rounded-md border border-input bg-background px-2 py-1.5 flex flex-wrap gap-1.5 items-center cursor-text focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring transition-colors"
                  onClick={() => spInputRef.current?.focus()}
                >
                  {salesPersons.map((s) => (
                    <span key={s.id} className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded px-2 py-0.5 shrink-0">
                      {s.name}
                      {s.isExt && <span className="relative -top-0.75 text-[8px] font-bold leading-none">ext</span>}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSalesPersons((prev) => prev.filter((x) => x.id !== s.id)); }}
                        className="text-blue-500/60 hover:text-blue-700 ml-0.5"
                      >
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
                      <option key={m.userId} value={m.userId}>{m.name ?? m.email}</option>
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
                      } else {
                        setSpInput(val);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !spInput && salesPersons.length > 0) {
                        setSalesPersons((prev) => prev.slice(0, -1));
                        return;
                      }
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
              </div>
            </div>
          </div>

          {/* Card 3: Categories */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Categories<span className="text-destructive ml-0.5 normal-case">*</span>
              </div>
            </div>
            <div className="p-4">
              <div>
                {categories.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-1">
                    No categories yet — create one in Organization → Categories
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {categories.map((c) => {
                      const selected = categoryIds.includes(c.id);
                      const hex = c.color ?? "#6366f1";
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() =>
                            setCategoryIds((prev) =>
                              selected ? prev.filter((id) => id !== c.id) : [...prev, c.id],
                            )
                          }
                          className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border-2 transition-all select-none",
                            selected
                              ? "text-white shadow-sm"
                              : "bg-background text-foreground/70 hover:text-foreground",
                          )}
                          style={
                            selected
                              ? { backgroundColor: hex, borderColor: hex }
                              : { borderColor: hex + "55" }
                          }
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: selected ? "rgba(255,255,255,0.8)" : hex }}
                          />
                          {c.name}
                          {selected && <span className="ml-0.5 opacity-80">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card 4: Terms & conditions */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Terms & conditions
              </div>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Delivery" className="col-span-2">
                  <Textarea
                    value={deliveryTerm}
                    onChange={(e) => setDeliveryTerm(e.target.value)}
                    rows={2}
                    className="text-sm resize-none"
                  />
                </Field>
                <Field label="Payment Terms">
                  <Input
                    value={paymentTerm}
                    onChange={(e) => setPaymentTerm(e.target.value)}
                    className="h-9 text-sm"
                  />
                </Field>
                <Field label="Warranty">
                  <Input
                    value={warranty}
                    onChange={(e) => setWarranty(e.target.value)}
                    className="h-9 text-sm"
                  />
                </Field>
                <Field label="Return Policy" className="col-span-2">
                  <Textarea
                    value={returnPolicy}
                    onChange={(e) => setReturnPolicy(e.target.value)}
                    rows={2}
                    className="text-sm resize-none"
                  />
                </Field>
              </div>
            </div>
          </div>

          {/* Card 5: Notes */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Notes
              </div>
            </div>
            <div className="p-4">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes..."
                rows={3}
                className="text-sm resize-none"
              />
            </div>
          </div>

          {/* Items card */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/20 border-b border-border flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Items · {items.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={addItem}
              >
                <PlusIcon className="w-3 h-3" /> Add row
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/10 border-b border-border">
                    {["#", "Code", "Description", "Qty", "UOM", "Unit Price", "Disc%", "Total", ""].map((h) => (
                      <th
                        key={h}
                        className={cn(
                          "px-3 py-2 text-[10px] font-medium text-muted-foreground whitespace-nowrap text-left",
                          ["Unit Price", "Total"].includes(h) && "text-right",
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Build display order: set groups first (grouped), then standalone
                    const seenGroupIds = new Set<string>();
                    const rows: React.ReactNode[] = [];

                    // Collect unique groups preserving order of first appearance
                    const groupOrder: string[] = [];
                    for (const it of items) {
                      if (it.setGroupId && !seenGroupIds.has(it.setGroupId)) {
                        seenGroupIds.add(it.setGroupId);
                        groupOrder.push(it.setGroupId);
                      }
                    }

                    // Render set groups
                    for (const gid of groupOrder) {
                      const groupItems = items.filter((it) => it.setGroupId === gid);
                      const first = groupItems[0];
                      const setQtyVal = first.setQty || "1";
                      const groupLabel = first.setGroupLabel || "Set";
                      const groupTotal = groupItems.reduce((s, it) => s + itemLineTotal(it), 0);

                      rows.push(
                        <tr key={`hdr-${gid}`} className="bg-blue-50/60 dark:bg-blue-900/10 border-b border-blue-200/60 dark:border-blue-800/40">
                          <td colSpan={3} className="px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              <LayersIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                                {groupLabel}
                              </span>
                              <span className="text-[10px] text-muted-foreground">×</span>
                              <input
                                type="number"
                                min="1"
                                value={setQtyVal}
                                onChange={(e) => updateSetQty(gid, e.target.value)}
                                className="h-6 w-14 border border-blue-200 dark:border-blue-700 rounded px-2 text-xs bg-background outline-none focus:ring-1 focus:ring-blue-400 text-right"
                              />
                              <span className="text-[10px] text-muted-foreground">sets</span>
                              {Number(setQtyVal) > 1 && (
                                <>
                                  <span className="text-[10px] text-muted-foreground">·</span>
                                  <span className="text-[10px] text-muted-foreground tabular-nums">
                                    {(groupTotal / Number(setQtyVal)).toLocaleString("en-MY", { minimumFractionDigits: 2 })} / set
                                  </span>
                                </>
                              )}
                            </div>
                          </td>
                          <td colSpan={4} />
                          <td className="px-3 py-1.5 text-right tabular-nums text-xs font-semibold text-blue-700 dark:text-blue-300">
                            {groupTotal.toLocaleString("en-MY", { minimumFractionDigits: 2 })}
                          </td>
                          <td />
                        </tr>,
                      );

                      groupItems.forEach((item) => {
                        rows.push(renderItemRow(item, true));
                      });
                    }

                    // Render standalone items
                    items
                      .filter((it) => !it.setGroupId)
                      .forEach((item) => rows.push(renderItemRow(item, false)));

                    return rows.length > 0 ? rows : (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-xs text-muted-foreground">
                          No items. Click "Add row" to add one.
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-3">
          {/* Pricing */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <SectionHeader title="Pricing" />
            <div className="p-4 space-y-3">
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Total discount</p>
                <div className="flex gap-1 mb-1.5">
                  <button
                    type="button"
                    onClick={() => setDiscountType("pct")}
                    className={`px-3 py-1 text-xs rounded-md border transition-colors ${discountType === "pct" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground"}`}
                  >
                    % Percentage
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscountType("fixed")}
                    className={`px-3 py-1 text-xs rounded-md border transition-colors ${discountType === "fixed" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground"}`}
                  >
                    RM Special
                  </button>
                </div>
                {discountType === "pct" ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={overallDiscount}
                      onChange={(e) => setOverallDiscount(e.target.value)}
                      className="h-9 text-sm text-right flex-1"
                      placeholder="0"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">RM</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={specialDiscAmt}
                      onChange={(e) => setSpecialDiscAmt(e.target.value)}
                      className="h-9 text-sm text-right flex-1"
                      placeholder="0.00"
                    />
                  </div>
                )}
              </div>
              <Field label="SST (%)">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={sstPct}
                  onChange={(e) => setSstPct(e.target.value)}
                  placeholder="0 = no SST"
                  className="h-9 text-sm text-right"
                />
              </Field>
              {/* Live summary */}
              <div className="pt-2 border-t border-border space-y-1.5 text-xs">
                {sets > 1 ? (
                  <>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal (1 set)</span>
                      <span className="tabular-nums">{fmt(subtotalPerSet)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground font-medium">
                      <span>× {sets} sets</span>
                      <span className="tabular-nums">{fmt(subtotal)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{fmt(subtotal)}</span>
                  </div>
                )}
                {discAmt > 0 && (
                  <div className="flex justify-between text-red-600 dark:text-red-400">
                    <span>{discountType === "pct" ? `Discount (${overallDiscount}%)` : "Special Discount"}</span>
                    <span className="tabular-nums">- {fmt(discAmt)}</span>
                  </div>
                )}
                {applySST && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>SST ({sstPct}%)</span>
                    <span className="tabular-nums">{fmt(sstAmt)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-border font-semibold">
                  <span>Grand total</span>
                  <span className="tabular-nums text-green-600 dark:text-green-400">
                    {fmt(grandTotal)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Document options */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <SectionHeader title="Document options" />
            <div className="p-4 space-y-4">
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Display</p>
                <OptionToggle label="Product code"     checked={showProductCode}  onChange={setShowProductCode} />
                <OptionToggle label="MDA certificates" checked={includeMdaCerts}  onChange={setIncludeMdaCerts} />
              </div>
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Attached Documents</p>
                <OptionToggle label="Product catalogue"                checked={includeCatalogue}     onChange={setIncludeCatalogue} />
                <OptionToggle label="MOF Certificate"                  checked={inclMof}              onChange={setInclMof} />
                <OptionToggle label="SSM"                              checked={inclSsm}              onChange={setInclSsm} />
                <OptionToggle label="TCC (Tax Compliance Certificate)" checked={inclTcc}              onChange={setInclTcc} />
                <OptionToggle label="Bank Statement"                   checked={inclBankStatement}    onChange={setInclBankStatement} />
                <OptionToggle label="MDA Establishment"                checked={inclMdaEstablishment} onChange={setInclMdaEstablishment} />
                <OptionToggle label="Lampiran 12"                      checked={inclLampiran12}       onChange={setInclLampiran12} />
                <OptionToggle label="Lampiran 13"                      checked={inclLampiran13}       onChange={setInclLampiran13} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
