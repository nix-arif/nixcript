"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  matchSpreadsheetToProducts,
  createQuotation,
  type SpreadsheetRow,
  type ReviewItem,
} from "@/server/quotation";
import { getCustomers } from "@/server/customer";
import { getOrgMembersForQuotation } from "@/server/quotation";
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
  CheckCircleIcon,
  AlertCircleIcon,
  AlertTriangleIcon,
  UploadIcon,
  FileSpreadsheetIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  XCircleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];
type Member = Awaited<ReturnType<typeof getOrgMembersForQuotation>>[number];

type Step = 1 | 2 | 3 | 4 | 5;

const fmt = (v: string | number) =>
  Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2 });

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

const STATUS_BADGE: Record<
  ReviewItem["status"],
  { label: string; icon: React.ReactNode; className: string }
> = {
  ok: {
    label: "OK",
    icon: <CheckCircleIcon className="w-3.5 h-3.5" />,
    className: "text-green-600 dark:text-green-400",
  },
  no_price: {
    label: "No price",
    icon: <AlertTriangleIcon className="w-3.5 h-3.5" />,
    className: "text-amber-600 dark:text-amber-400",
  },
  no_cert: {
    label: "No cert",
    icon: <AlertCircleIcon className="w-3.5 h-3.5" />,
    className: "text-orange-600 dark:text-orange-400",
  },
  no_price_no_cert: {
    label: "No price & cert",
    icon: <AlertCircleIcon className="w-3.5 h-3.5" />,
    className: "text-red-600 dark:text-red-400",
  },
  not_found: {
    label: "Not in DB",
    icon: <XCircleIcon className="w-3.5 h-3.5" />,
    className: "text-red-600 dark:text-red-400",
  },
};

interface Props {
  customers: Customer[];
  members: Member[];
  quotationNo: string;
  currentUserId: string;
  currentUserName: string;
  ownerOrgs: { id: string; name: string; slug: string }[];
  activeOrgId: string;
}

export function NewQuotationClient({
  customers,
  members,
  quotationNo,
  currentUserId,
  currentUserName,
  ownerOrgs,
  activeOrgId,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  // Step 1 state
  const [mode, setMode] = useState<"single" | "comparison">("single");
  const [title, setTitle] = useState("Loose Items");
  const [sets, setSets] = useState(1);
  const [customerId, setCustomerId] = useState("");
  const [salesPersonId, setSalesPersonId] = useState("");
  const [salesPersonName, setSalesPersonName] = useState("");
  const [validDays, setValidDays] = useState("30");
  const [notes, setNotes] = useState("");

  // Step 2 state
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<SpreadsheetRow[]>([]);
  const [parsing, setParsing] = useState(false);

  // Step 3 state
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [matching, setMatching] = useState(false);

  // Step 4 state
  const [overallDiscount, setOverallDiscount] = useState("0");
  const [sstPct, setSstPct] = useState("0");
  const [applySST, setApplySST] = useState(false);
  const [applyItemizeDiscount, setApplyItemizeDiscount] = useState(false);
  const [applyTotalDiscount, setApplyTotalDiscount] = useState(false);

  const [isDragging, setIsDragging] = useState(false);

  // Step 5 state
  const [includeCatalogue, setIncludeCatalogue] = useState(true);
  const [includeMdaCerts, setIncludeMdaCerts] = useState(true);
  const [showTotalPrice, setShowTotalPrice] = useState(true);
  const [showItemizeDiscount, setShowItemizeDiscount] = useState(false);
  const [inclMof, setInclMof] = useState(true);
  const [inclSsm, setInclSsm] = useState(true);
  const [inclTcc, setInclTcc] = useState(true);
  const [inclBankStatement, setInclBankStatement] = useState(true);
  const [inclMdaEstablishment, setInclMdaEstablishment] = useState(true);
  const [inclLampiran12, setInclLampiran12] = useState(true);
  const [inclLampiran13, setInclLampiran13] = useState(true);
  const [creating, setCreating] = useState(false);

  // ── Computed totals ──────────────────────────────────────────────────────
  const subtotalPerSet = reviewItems.reduce((s, item) => {
    return s + Number(item.qty ?? 1) * Number(item.unitPrice ?? 0);
  }, 0);
  const subtotalNSets = subtotalPerSet * sets;

  const itemDiscPerSet = reviewItems.reduce((s, item) => {
    const qty = Number(item.qty ?? 1);
    const price = Number(item.unitPrice ?? 0);
    const disc = Number(item.discountPct ?? 0) / 100;
    return s + qty * price * disc;
  }, 0);
  const itemDiscTotal = applyItemizeDiscount ? itemDiscPerSet * sets : 0;

  const afterItemDisc = subtotalNSets - itemDiscTotal;
  const overallDiscAmt = applyTotalDiscount
    ? afterItemDisc * (Number(overallDiscount || 0) / 100)
    : 0;
  const totalDisc = itemDiscTotal + overallDiscAmt;
  const afterAllDisc = subtotalNSets - totalDisc;
  const sstAmt = applySST ? afterAllDisc * (Number(sstPct || 8) / 100) : 0;
  const grandTotal = afterAllDisc + sstAmt;

  // ── Step 2: parse spreadsheet ────────────────────────────────────────────
  //   const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
  //     const file = e.target.files?.[0];
  //     if (!file) return;
  //     setParsing(true);
  //     setFileName(file.name);

  //     const reader = new FileReader();
  //     reader.onload = (ev) => {
  //       try {
  //         const data = new Uint8Array(ev.target?.result as ArrayBuffer);
  //         const wb = XLSX.read(data, { type: "array" });
  //         const ws = wb.Sheets[wb.SheetNames[0]];
  //         const json = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });

  //         const rows: SpreadsheetRow[] = json
  //           .map((row: any, i: number) => ({
  //             rowNo: i + 1,
  //             sku: String(row["SKU"] ?? row["sku"] ?? "").trim(),
  //             productCode: String(
  //               row["Product Code"] ??
  //                 row["product_code"] ??
  //                 row["ProductCode"] ??
  //                 "",
  //             ).trim(),
  //             description: String(
  //               row["Description"] ?? row["description"] ?? "",
  //             ).trim(),
  //             qty: String(row["Qty"] ?? row["qty"] ?? row["QTY"] ?? "1").trim(),
  //             uom: String(row["UOM"] ?? row["uom"] ?? "").trim(),
  //             unitPrice: String(
  //               row["Unit Price"] ?? row["unit_price"] ?? row["UnitPrice"] ?? "",
  //             ).trim(),
  //             totalPrice: String(
  //               row["Total Price"] ??
  //                 row["total_price"] ??
  //                 row["TotalPrice"] ??
  //                 "",
  //             ).trim(),
  //           }))
  //           .filter((r) => r.productCode || r.description);

  //         setRawRows(rows);
  //         toast.success(`${rows.length} rows parsed`);
  //       } catch {
  //         toast.error("Failed to parse spreadsheet");
  //       } finally {
  //         setParsing(false);
  //       }
  //     };
  //     reader.readAsArrayBuffer(file);
  //     e.target.value = "";
  //   };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const processFile = (file: File) => {
    setParsing(true);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });

        const rows: SpreadsheetRow[] = json
          .map((row: any, i: number) => ({
            rowNo: i + 1,
            sku: String(row["SKU"] ?? row["sku"] ?? "").trim(),
            productCode: String(
              row["Product Code"] ??
                row["product_code"] ??
                row["ProductCode"] ??
                row["product code"] ??
                "",
            ).trim(),
            description: String(
              row["Description"] ?? row["description"] ?? "",
            ).trim(),
            qty: String(row["Qty"] ?? row["qty"] ?? row["QTY"] ?? "1").trim(),
            uom: String(row["UOM"] ?? row["uom"] ?? "").trim(),
            unitPrice: String(
              row["Unit Price"] ??
                row["unit_price"] ??
                row["UnitPrice"] ??
                row["unit price"] ??
                "",
            ).trim(),
            discountPct: String(
              row["Disc %"] ??
                row["Disc"] ??
                row["disc"] ??
                row["Discount %"] ??
                row["Discount"] ??
                row["discount"] ??
                "",
            ).trim(),
            totalPrice: String(
              row["Total Price"] ??
                row["total_price"] ??
                row["TotalPrice"] ??
                "",
            ).trim(),
          }))
          .filter((r) => r.productCode || r.description);

        setRawRows(rows);
        toast.success(`${rows.length} rows parsed`);
      } catch {
        toast.error("Failed to parse spreadsheet");
      } finally {
        setParsing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Update handleFileUpload to use processFile:
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
    e.target.value = "";
  };

  // ── Step 3: match to DB ──────────────────────────────────────────────────
  const handleMatchProducts = async () => {
    setMatching(true);
    try {
      const items = await matchSpreadsheetToProducts(rawRows);
      setReviewItems(items);
      // Auto-check itemize discount if any item came with a disc value
      const hasDiscounts = items.some((i) => Number(i.discountPct) > 0);
      setApplyItemizeDiscount(hasDiscounts);
      setStep(3);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setMatching(false);
    }
  };

  const updateItemDiscount = (i: number, pct: string) => {
    setReviewItems((prev) => {
      const next = [...prev];
      const item = next[i];
      const qty = Number(item.qty ?? 1);
      const price = Number(item.unitPrice ?? 0);
      const disc = Number(pct) / 100;
      next[i] = {
        ...item,
        discountPct: pct,
        discountAmt: (qty * price * disc).toFixed(2),
        computedTotal: (qty * price * (1 - disc)).toFixed(2),
      };
      return next;
    });
  };

  const updateItemPrice = (i: number, price: string) => {
    setReviewItems((prev) => {
      const next = [...prev];
      const item = next[i];
      const qty = Number(item.qty ?? 1);
      const disc = Number(item.discountPct ?? 0) / 100;
      next[i] = {
        ...item,
        unitPrice: price,
        hasPrice: Number(price) > 0,
        priceSource: "sheet",
        computedTotal: (qty * Number(price) * (1 - disc)).toFixed(2),
        status:
          Number(price) > 0
            ? item.hasCert
              ? "ok"
              : "no_cert"
            : item.hasCert
              ? "no_price"
              : "no_price_no_cert",
      };
      return next;
    });
  };

  // ── Step 5: create quotation ──────────────────────────────────────────────
  const handleCreate = async () => {
    setCreating(true);
    try {
      // Keep per-set qty as-is; only zero out discounts if checkbox is unchecked
      const finalItems = reviewItems.map((item) => {
        const qty = Number(item.qty ?? 1);
        const price = Number(item.unitPrice ?? 0);
        const effectiveDiscPct = applyItemizeDiscount ? Number(item.discountPct ?? 0) : 0;
        const disc = effectiveDiscPct / 100;
        return {
          ...item,
          discountPct: String(effectiveDiscPct),
          discountAmt: (qty * price * disc).toFixed(2),
          computedTotal: (qty * price * (1 - disc)).toFixed(2),
        };
      });

      const q = await createQuotation({
        mode,
        title: sets > 1 ? `${title || "Loose Items"} X ${sets} SETS` : (title || "Loose Items"),
        sets,
        customerId: customerId || undefined,
        salesPersonId: salesPersonId || undefined,
        salesPersonName,
        validDays: Number(validDays),
        notes,
        items: finalItems,
        overallDiscountPct: applyTotalDiscount ? (overallDiscount || "0") : "0",
        sstPct: applySST ? sstPct || "8" : "0",
        includeCatalogue,
        includeMdaCerts,
        showTotalPrice,
        showItemizeDiscount,
        inclMof,
        inclSsm,
        inclTcc,
        inclBankStatement,
        inclMdaEstablishment,
        inclLampiran12,
        inclLampiran13,
      });

      if (!q) throw new Error("Failed to create quotation");
      toast.success(`Quotation ${q.quotationNo} created`);
      router.push(`/dashboard/sales/quotation/${q.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const okCount = reviewItems.filter((i) => i.status === "ok").length;
  const noPriceCount = reviewItems.filter(
    (i) => i.status === "no_price" || i.status === "no_price_no_cert",
  ).length;
  const noCertCount = reviewItems.filter(
    (i) => i.status === "no_cert" || i.status === "no_price_no_cert",
  ).length;
  const notFoundCount = reviewItems.filter(
    (i) => i.status === "not_found",
  ).length;

  // ── Step indicator ────────────────────────────────────────────────────────
  const STEPS = ["Setup", "Upload", "Review", "Pricing", "Generate"];

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">New quotation</h1>
        <p className="text-sm text-muted-foreground mt-1">{quotationNo}</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center mb-6">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const isActive = step === n;
          const isDone = step > n;
          return (
            <div
              key={s}
              className="flex items-center"
              style={{ flex: i < STEPS.length - 1 ? 1 : "none" }}
            >
              <div className="flex items-center gap-2 shrink-0">
                <div
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium border-2 transition-all",
                    isActive
                      ? "bg-primary border-primary text-primary-foreground"
                      : isDone
                        ? "bg-green-500 border-green-500 text-white"
                        : "bg-background border-border text-muted-foreground",
                  )}
                >
                  {isDone ? <CheckCircleIcon className="w-4 h-4" /> : n}
                </div>
                <span
                  className={cn(
                    "text-xs font-medium whitespace-nowrap",
                    isActive
                      ? "text-primary"
                      : isDone
                        ? "text-green-600 dark:text-green-400"
                        : "text-muted-foreground",
                  )}
                >
                  {s}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-px mx-3",
                    isDone ? "bg-green-400" : "bg-border",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* ── STEP 1: Setup ──────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-5">
          {/* Mode */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Quotation mode
              </div>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              {(
                [
                  {
                    value: "single",
                    label: "Single quotation",
                    desc: "Current organization only",
                  },
                  {
                    value: "comparison",
                    label: "With comparison",
                    desc:
                      ownerOrgs.length > 1
                        ? `${ownerOrgs.length} quotations (1 original + ${ownerOrgs.length - 1} dummy)`
                        : "No other organizations found for comparison",
                    disabled: ownerOrgs.length <= 1,
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => !("disabled" in opt && opt.disabled) && setMode(opt.value)}
                  disabled={"disabled" in opt && opt.disabled}
                  className={cn(
                    "p-3 rounded-lg border text-left transition-all",
                    mode === opt.value
                      ? "border-2 border-primary bg-primary/5"
                      : "border border-border hover:border-border",
                    "disabled" in opt && opt.disabled
                      ? "opacity-40 cursor-not-allowed"
                      : "",
                  )}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {opt.desc}
                  </div>
                </button>
              ))}
              {mode === "comparison" && ownerOrgs.length > 1 && (
                <div className="col-span-2 rounded-lg bg-muted/30 border border-border p-3 space-y-1.5">
                  {ownerOrgs.map((org) => (
                    <div key={org.id} className="flex items-center justify-between text-xs">
                      <span className="font-medium">{org.name}</span>
                      <span className={cn(
                        "rounded px-1.5 py-0.5 text-[10px]",
                        org.id === activeOrgId
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}>
                        {org.id === activeOrgId ? "original" : "dummy"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quotation title */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Quotation title
              </div>
            </div>
            <div className="p-4 space-y-4">
              <Field label="Title (shown on document)">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Loose Items, Medical Equipment Supply..."
                  className="h-9 text-sm"
                />
              </Field>
              <Field label="Number of sets">
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    value={sets}
                    onChange={(e) => setSets(Math.max(1, Number(e.target.value) || 1))}
                    className="h-9 text-sm w-28"
                    min="1"
                  />
                  {sets > 1 && (
                    <span className="text-xs text-muted-foreground">
                      All spreadsheet quantities × {sets} sets
                    </span>
                  )}
                </div>
              </Field>
            </div>
          </div>

          {/* Customer + Sales */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Customer & sales info
              </div>
            </div>
            <div className="p-4 space-y-4">
              <Field label="Customer">
                <Select onValueChange={setCustomerId} value={customerId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {[c.title, c.name].filter(Boolean).join(" ")} —{" "}
                        {c.organizationName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {selectedCustomer && (
                <div className="p-3 bg-muted/30 rounded-lg text-xs text-muted-foreground space-y-1">
                  <div>
                    {selectedCustomer.position}
                    {selectedCustomer.department
                      ? ` · ${selectedCustomer.department}`
                      : ""}
                  </div>
                  <div>{selectedCustomer.organizationAddress}</div>
                  <div>
                    {selectedCustomer.email}
                    {selectedCustomer.contactNo
                      ? ` · ${selectedCustomer.contactNo}`
                      : ""}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Sales person">
                  <Select
                    onValueChange={(v) => {
                      setSalesPersonId(v);
                      const m = members.find((x) => x.userId === v);
                      setSalesPersonName(m?.name ?? "");
                    }}
                    value={salesPersonId}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select member" />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Prepared by">
                  <div className="h-9 border border-input rounded-md px-3 flex items-center text-sm text-muted-foreground bg-muted/20">
                    {currentUserName}
                  </div>
                </Field>
                <Field label="Valid for (days)">
                  <Input
                    type="number"
                    value={validDays}
                    onChange={(e) => setValidDays(e.target.value)}
                    className="h-9 text-sm"
                    min="1"
                  />
                </Field>
                <Field label="Quotation no.">
                  <div className="h-9 border border-input rounded-md px-3 flex items-center text-sm font-mono text-muted-foreground bg-muted/20">
                    {quotationNo}
                  </div>
                </Field>
              </div>

              <Field label="Notes / remarks">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. As per discussion on 12 May 2025..."
                  rows={2}
                  className="text-sm resize-none"
                />
              </Field>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => setStep(2)} className="gap-2">
              Next: Upload spreadsheet <ChevronRightIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Upload ─────────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Upload spreadsheet
              </div>
            </div>
            <div className="p-4 space-y-4">
              <label className="block cursor-pointer">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={cn(
                    "border-2 border-dashed rounded-lg p-8 text-center transition-colors hover:border-primary/40 hover:bg-muted/10",
                    rawRows.length > 0
                      ? "border-green-400 bg-green-50 dark:bg-green-900/10"
                      : "border-border",
                  )}
                >
                  {rawRows.length > 0 ? (
                    <div className="space-y-2">
                      <CheckCircleIcon className="w-8 h-8 text-green-600 mx-auto" />
                      <div className="text-sm font-medium text-green-700 dark:text-green-400">
                        {fileName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {rawRows.length} rows parsed
                      </div>
                      <label className="inline-flex items-center gap-1.5 text-xs text-primary cursor-pointer hover:underline">
                        <UploadIcon className="w-3 h-3" /> Replace file
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          className="hidden"
                          onChange={handleFileUpload}
                        />
                      </label>
                    </div>
                  ) : parsing ? (
                    <div className="space-y-2">
                      <span className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin block mx-auto" />
                      <div className="text-sm text-muted-foreground">
                        Parsing...
                      </div>
                    </div>
                  ) : (
                    <label className="cursor-pointer block">
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                      <div className="space-y-2">
                        <FileSpreadsheetIcon className="w-8 h-8 text-muted-foreground mx-auto" />
                        <div className="text-sm font-medium">
                          {isDragging
                            ? "Drop it here"
                            : "Drop spreadsheet here or click to browse"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          .xlsx or .csv
                        </div>
                      </div>
                    </label>
                  )}
                </div>
              </label>

              <div className="p-3 bg-muted/30 rounded-lg">
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  Expected columns
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "No",
                    "SKU",
                    "Product Code",
                    "Description",
                    "Qty",
                    "UOM",
                    "Unit Price",
                    "Disc %",
                    "Total Price",
                  ].map((col) => (
                    <span
                      key={col}
                      className="text-[11px] bg-background border border-border rounded px-2 py-0.5 font-mono"
                    >
                      {col}
                    </span>
                  ))}
                </div>
                <div className="text-[11px] text-muted-foreground mt-2">
                  Product Code is the key field. Other columns override DB
                  values if filled.
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => setStep(1)}
              className="gap-2"
            >
              <ChevronLeftIcon className="w-4 h-4" /> Back
            </Button>
            <Button
              onClick={handleMatchProducts}
              disabled={rawRows.length === 0 || matching}
              className="gap-2"
            >
              {matching && (
                <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              )}
              Match products <ChevronRightIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Review ──────────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Review items
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {reviewItems.length} items{sets > 1 ? ` · ${sets} sets (qty shown per set)` : ""}
                </div>
              </div>
              <div className="flex gap-1.5">
                {okCount > 0 && (
                  <span className="text-[10px] bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded px-2 py-0.5">
                    {okCount} OK
                  </span>
                )}
                {noPriceCount > 0 && (
                  <span className="text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded px-2 py-0.5">
                    {noPriceCount} no price
                  </span>
                )}
                {noCertCount > 0 && (
                  <span className="text-[10px] bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 rounded px-2 py-0.5">
                    {noCertCount} no cert
                  </span>
                )}
                {notFoundCount > 0 && (
                  <span className="text-[10px] bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded px-2 py-0.5">
                    {notFoundCount} not found
                  </span>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/20">
                    {[
                      "#",
                      "Product code",
                      "Description",
                      "Qty",
                      "UOM",
                      "Unit price",
                      "Disc %",
                      "Total",
                      "Cert",
                      "Status",
                    ].map((h) => (
                      <th
                        key={h}
                        className={cn(
                          "px-3 py-2 text-[10px] font-medium text-muted-foreground border-b border-border",
                          ["Unit price", "Total"].includes(h)
                            ? "text-right"
                            : "text-left",
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reviewItems.map((item, i) => {
                    const st = STATUS_BADGE[item.status];
                    return (
                      <tr
                        key={i}
                        className={cn(
                          i < reviewItems.length - 1
                            ? "border-b border-border"
                            : "",
                          i % 2 === 1 ? "bg-muted/10" : "",
                          item.status === "not_found" ? "opacity-50" : "",
                        )}
                      >
                        <td className="px-3 py-2 text-muted-foreground">
                          {item.rowNo}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {item.productCode ?? "—"}
                        </td>
                        <td className="px-3 py-2 max-w-[160px] truncate">
                          {item.description}
                          {item.descriptionSource === "sheet" && (
                            <span className="ml-1 text-[9px] text-blue-500">
                              sheet
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{item.qty}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {item.uom || "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            value={item.unitPrice ?? "0"}
                            onChange={(e) => updateItemPrice(i, e.target.value)}
                            className="w-20 h-6 border border-input rounded px-1.5 text-right text-xs bg-background"
                          />
                          {item.priceSource === "sheet" && (
                            <span className="ml-1 text-[9px] text-blue-500">
                              sheet
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={item.discountPct ?? "0"}
                            onChange={(e) =>
                              updateItemDiscount(i, e.target.value)
                            }
                            className="w-14 h-6 border border-input rounded px-1.5 text-right text-xs bg-background"
                            min="0"
                            max="100"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {fmt(item.computedTotal)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {item.hasCert ? (
                            <CheckCircleIcon className="w-3.5 h-3.5 text-green-600 inline" />
                          ) : (
                            <AlertCircleIcon className="w-3.5 h-3.5 text-orange-500 inline" />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div
                            className={cn(
                              "flex items-center gap-1",
                              st.className,
                            )}
                          >
                            {st.icon}
                            <span className="text-[10px]">{st.label}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => setStep(2)}
              className="gap-2"
            >
              <ChevronLeftIcon className="w-4 h-4" /> Back
            </Button>
            <Button onClick={() => setStep(4)} className="gap-2">
              Next: Pricing <ChevronRightIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Pricing ──────────────────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pricing & discount
              </div>
            </div>
            <div className="p-4 space-y-4">

              {/* Subtotal rows */}
              <div className="rounded-lg border border-border divide-y divide-border">
                <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-muted-foreground">Subtotal × 1 set</span>
                  <span className="font-mono font-medium">RM {fmt(subtotalPerSet)}</span>
                </div>
                {sets > 1 && (
                  <div className="flex items-center justify-between px-4 py-2.5 text-sm bg-muted/20">
                    <span className="text-muted-foreground">Subtotal × {sets} sets</span>
                    <span className="font-mono font-semibold">RM {fmt(subtotalNSets)}</span>
                  </div>
                )}
              </div>

              {/* Three checkboxes: itemize disc, total disc, SST */}
              <div className="rounded-lg border border-border divide-y divide-border">
                {/* Itemize discount */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    id="applyItemDisc"
                    checked={applyItemizeDiscount}
                    onChange={(e) => setApplyItemizeDiscount(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <label htmlFor="applyItemDisc" className="text-sm font-medium cursor-pointer flex-1">
                    Apply itemize discount
                  </label>
                  {applyItemizeDiscount && itemDiscTotal > 0 && (
                    <span className="text-sm text-red-600 dark:text-red-400 font-mono tabular-nums">
                      − RM {fmt(itemDiscTotal)}
                    </span>
                  )}
                </div>

                {/* Total discount */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    id="applyTotalDisc"
                    checked={applyTotalDiscount}
                    onChange={(e) => setApplyTotalDiscount(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <label htmlFor="applyTotalDisc" className="text-sm font-medium cursor-pointer flex-1">
                    Apply total discount
                  </label>
                  {applyTotalDiscount && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={overallDiscount}
                        onChange={(e) => setOverallDiscount(e.target.value)}
                        className="h-7 text-sm w-16 text-right"
                        min="0"
                        max="100"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                      {overallDiscAmt > 0 && (
                        <span className="text-sm text-red-600 dark:text-red-400 font-mono tabular-nums">
                          − RM {fmt(overallDiscAmt)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Apply SST */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    id="applySST"
                    checked={applySST}
                    onChange={(e) => setApplySST(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <label htmlFor="applySST" className="text-sm font-medium cursor-pointer flex-1">
                    Apply SST
                  </label>
                  {applySST && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={sstPct || "8"}
                        onChange={(e) => setSstPct(e.target.value)}
                        className="h-7 text-sm w-16 text-right"
                        min="0"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                      {sstAmt > 0 && (
                        <span className="text-sm text-muted-foreground font-mono tabular-nums">
                          + RM {fmt(sstAmt)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Grand total formula */}
              <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-2">
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3">
                  Grand Total
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-mono tabular-nums">
                  <span className="text-foreground">
                    RM {fmt(subtotalNSets)}
                  </span>
                  {(applyItemizeDiscount || applyTotalDiscount) && totalDisc > 0 && (
                    <>
                      <span className="text-muted-foreground">−</span>
                      <span className="text-red-600 dark:text-red-400">RM {fmt(totalDisc)}</span>
                    </>
                  )}
                  {applySST && sstAmt > 0 && (
                    <>
                      <span className="text-muted-foreground">+</span>
                      <span className="text-blue-600 dark:text-blue-400">RM {fmt(sstAmt)}</span>
                    </>
                  )}
                  <span className="text-muted-foreground">=</span>
                  <span className="text-xl font-semibold text-green-600 dark:text-green-400">
                    RM {fmt(grandTotal)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground font-sans">
                  <span>Subtotal × {sets} {sets > 1 ? "sets" : "set"}</span>
                  {(applyItemizeDiscount || applyTotalDiscount) && totalDisc > 0 && (
                    <><span>−</span><span>Total disc</span></>
                  )}
                  {applySST && sstAmt > 0 && (
                    <><span>+</span><span>SST</span></>
                  )}
                  <span>=</span><span>Grand total</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => setStep(3)}
              className="gap-2"
            >
              <ChevronLeftIcon className="w-4 h-4" /> Back
            </Button>
            <Button onClick={() => setStep(5)} className="gap-2">
              Next: Generate <ChevronRightIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 5: Generate ────────────────────────────────────────────────── */}
      {step === 5 && (
        <div className="space-y-4">
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Generate quotation
              </div>
            </div>
            <div className="p-4 space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-muted/30 rounded-lg text-sm">
                <div>
                  <span className="text-muted-foreground">Quotation no. </span>
                  <span className="font-mono font-medium">{quotationNo}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Customer </span>
                  <span className="font-medium">
                    {selectedCustomer
                      ? [selectedCustomer.title, selectedCustomer.name]
                          .filter(Boolean)
                          .join(" ")
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Items </span>
                  <span className="font-medium">{reviewItems.length}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Sets </span>
                  <span className="font-medium">{sets}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Grand total </span>
                  <span className="font-medium text-green-600">
                    RM {fmt(grandTotal)}
                  </span>
                  <div className="text-xs text-muted-foreground mt-0.5 font-mono tabular-nums">
                    RM {fmt(subtotalNSets)}
                    {totalDisc > 0 && ` − RM ${fmt(totalDisc)} disc`}
                    {sstAmt > 0 && ` + RM ${fmt(sstAmt)} SST`}
                    {` = RM ${fmt(grandTotal)}`}
                  </div>
                </div>
              </div>

              {/* Options */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Display</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "catalogue",  label: "Product catalogue",  value: includeCatalogue,     set: setIncludeCatalogue },
                    { id: "certs",      label: "MDA certificates",   value: includeMdaCerts,      set: setIncludeMdaCerts },
                    { id: "totalprice", label: "Show total prices",  value: showTotalPrice,       set: setShowTotalPrice },
                    { id: "itemdisc",   label: "Itemize discount",   value: showItemizeDiscount,  set: setShowItemizeDiscount },
                  ].map((opt) => (
                    <div key={opt.id} className="flex items-center gap-2.5 p-3 border border-border rounded-lg">
                      <input type="checkbox" id={opt.id} checked={opt.value} onChange={(e) => opt.set(e.target.checked)} className="w-4 h-4" />
                      <label htmlFor={opt.id} className="text-sm cursor-pointer">{opt.label}</label>
                    </div>
                  ))}
                </div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Attached Documents</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "mof",      label: "MOF Certificate",                         value: inclMof,              set: setInclMof },
                    { id: "ssm",      label: "SSM",                                     value: inclSsm,              set: setInclSsm },
                    { id: "tcc",      label: "TCC (Tax Compliance Certificate)",         value: inclTcc,              set: setInclTcc },
                    { id: "bank",     label: "Bank Statement",                           value: inclBankStatement,    set: setInclBankStatement },
                    { id: "mda",      label: "MDA Establishment",                        value: inclMdaEstablishment, set: setInclMdaEstablishment },
                    { id: "lamp12",   label: "Lampiran 12",                              value: inclLampiran12,       set: setInclLampiran12 },
                    { id: "lamp13",   label: "Lampiran 13",                              value: inclLampiran13,       set: setInclLampiran13 },
                  ].map((opt) => (
                    <div key={opt.id} className="flex items-center gap-2.5 p-3 border border-border rounded-lg">
                      <input type="checkbox" id={opt.id} checked={opt.value} onChange={(e) => opt.set(e.target.checked)} className="w-4 h-4" />
                      <label htmlFor={opt.id} className="text-sm cursor-pointer">{opt.label}</label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Warnings */}
              {noPriceCount > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangleIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {noPriceCount} item{noPriceCount > 1 ? "s" : ""} have no price
                  — they will show RM 0.00 in the quotation.
                </div>
              )}
              {noCertCount > 0 && (
                <div className="flex items-start gap-2 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg text-xs text-orange-700 dark:text-orange-400">
                  <AlertCircleIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {noCertCount} item{noCertCount > 1 ? "s" : ""} have no MDA
                  certificate — certificate page will be omitted for these
                  items.
                </div>
              )}

              <Button
                onClick={handleCreate}
                disabled={creating}
                className="w-full h-11 text-sm gap-2"
              >
                {creating && (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                )}
                Create quotation — {quotationNo}
              </Button>
            </div>
          </div>

          <div className="flex justify-start">
            <Button
              variant="outline"
              onClick={() => setStep(4)}
              className="gap-2"
            >
              <ChevronLeftIcon className="w-4 h-4" /> Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
