"use client";

import { useState, useCallback, useRef } from "react";
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
import { PageHeader } from "@/components/page-header";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];
type Member = Awaited<ReturnType<typeof getOrgMembersForQuotation>>[number];

type Step = 1 | 2 | 3 | 4;

const fmt = (v: string | number) =>
  Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2 });

function parseRoman(s: string): number {
  const map: Record<string, number> = { I:1, V:5, X:10, L:50, C:100, D:500, M:1000 };
  const str = s.toUpperCase().trim();
  if (!/^[IVXLCDM]+$/.test(str)) return NaN;
  let result = 0;
  for (let i = 0; i < str.length; i++) {
    const cur = map[str[i]];
    const next = map[str[i + 1]];
    result += next > cur ? -cur : cur;
  }
  return result > 0 ? result : NaN;
}

function parseRowNo(raw: any, fallback: number): string {
  const str = String(raw ?? "").trim();
  // No value — use sequential fallback
  if (!str || str === "0") return String(fallback);
  // Already a clean string (e.g. "1a", "1b", "2c", "III") — keep as-is
  // but normalise Roman numerals to their arabic equivalent for ordering
  const roman = parseRoman(str);
  if (!isNaN(roman) && /^[IVXLCDMivxlcdm]+$/i.test(str)) return String(roman);
  return str;
}

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
  const [customerOrgMemberId, setCustomerCompanyId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const customerBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [salesPersonId, setSalesPersonId] = useState("");
  const [salesPersonName, setSalesPersonName] = useState("");
  const [validDays, setValidDays] = useState("30");
  const [notes, setNotes] = useState("");
  const [deliveryTerm, setDeliveryTerm] = useState("EX-STOCK SUBJECT PRIOR SALES, OTHERWISE 8 – 12 WEEKS");
  const [paymentTerm, setPaymentTerm] = useState("30 days");
  const [returnPolicy, setReturnPolicy] = useState("GOODS ONCE SOLD WILL NOT TAKEN BACK");
  const [warranty, setWarranty] = useState("5 years against material and manufacturing defects");

  // Step 2 state
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<SpreadsheetRow[]>([]);
  const [parsing, setParsing] = useState(false);

  // Step 3 state
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [matching, setMatching] = useState(false);

  // Step 4 state
  const [overallDiscount, setOverallDiscount] = useState("0");
  const [specialDiscAmt, setSpecialDiscAmt] = useState("0");
  const [discountType, setDiscountType] = useState<"pct" | "fixed">("pct");
  const [sstPct, setSstPct] = useState("0");
  const [applySST, setApplySST] = useState(false);
  const [applyItemizeDiscount, setApplyItemizeDiscount] = useState(false);
  const [applyTotalDiscount, setApplyTotalDiscount] = useState(false);

  const [isDragging, setIsDragging] = useState(false);

  // Step 5 state
  const [includeCatalogue, setIncludeCatalogue] = useState(true);
  const [includeMdaCerts, setIncludeMdaCerts] = useState(true);
  const [showProductCode, setShowProductCode] = useState(true);
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
    const qty = Number(item.qty ?? 1);
    const price = Number(item.unitPrice ?? 0);
    const setMul = item.setGroupId ? Number(item.setQty || 1) : 1;
    const dur = item.lineType === "rent" ? Number(item.rentalDuration || 1) : 1;
    return s + qty * setMul * dur * price;
  }, 0);
  const subtotalNSets = subtotalPerSet * sets;

  const itemDiscPerSet = reviewItems.reduce((s, item) => {
    const qty = Number(item.qty ?? 1);
    const price = Number(item.unitPrice ?? 0);
    const disc = Number(item.discountPct ?? 0) / 100;
    const setMul = item.setGroupId ? Number(item.setQty || 1) : 1;
    const dur = item.lineType === "rent" ? Number(item.rentalDuration || 1) : 1;
    return s + qty * setMul * dur * price * disc;
  }, 0);
  const itemDiscTotal = applyItemizeDiscount ? itemDiscPerSet * sets : 0;

  const afterItemDisc = subtotalNSets - itemDiscTotal;
  const overallDiscAmt = applyTotalDiscount
    ? discountType === "pct"
      ? afterItemDisc * (Number(overallDiscount || 0) / 100)
      : Number(specialDiscAmt || 0)
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

        // Normalize all column keys to lowercase+trimmed for case-insensitive matching
        const normalizedJson = json.map((row: any) =>
          Object.fromEntries(
            Object.entries(row).map(([k, v]) => [k.toLowerCase().trim().replace(/\s+/g, " "), v]),
          ),
        );

        const col = (row: any, ...names: string[]) => {
          for (const n of names) {
            const v = row[n.toLowerCase().trim().replace(/\s+/g, " ")];
            if (v !== undefined && v !== "") return String(v);
          }
          return "";
        };

        const rows: SpreadsheetRow[] = normalizedJson
          .map((row: any, i: number) => ({
            rowNo: parseRowNo(col(row, "No", "no", "#") || String(i + 1), i + 1),
            sku: col(row, "SKU", "sku").trim(),
            productCode: col(row, "Product Code", "product_code", "ProductCode", "Code", "Kode").trim(),
            description: col(row, "Description", "Desc", "Nama", "Item", "Item Description").trim(),
            qty: col(row, "Qty", "QTY", "Quantity", "Kuantiti") || "1",
            uom: col(row, "UOM", "OUM", "Uom", "Oum", "Unit", "Unit of Measure", "unit_of_measure", "Satuan").trim(),
            unitPrice: col(row, "Unit Price", "unit_price", "UnitPrice", "Price", "Harga").trim(),
            discountPct: col(row, "Disc %", "Disc", "Discount %", "Discount", "Diskaun").trim(),
            totalPrice: col(row, "Total Price", "total_price", "TotalPrice", "Total").trim(),
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

  function reviewItemTotal(item: ReviewItem): number {
    const qty = Number(item.qty ?? 1);
    const price = Number(item.unitPrice ?? 0);
    const disc = Number(item.discountPct ?? 0) / 100;
    const setMul = item.setGroupId ? Number(item.setQty || 1) : 1;
    const dur = item.lineType === "rent" ? Number(item.rentalDuration || 1) : 1;
    return qty * setMul * dur * price * (1 - disc);
  }

  const updateItemField = (i: number, patch: Partial<ReviewItem>) => {
    setReviewItems((prev) => {
      const next = [...prev];
      const merged = { ...next[i], ...patch };
      const total = reviewItemTotal(merged);
      const qty = Number(merged.qty ?? 1);
      const price = Number(merged.unitPrice ?? 0);
      const disc = Number(merged.discountPct ?? 0) / 100;
      next[i] = {
        ...merged,
        discountAmt: (qty * price * disc).toFixed(2),
        computedTotal: total.toFixed(2),
      };
      return next;
    });
  };

  const updateItemDiscount = (i: number, pct: string) => updateItemField(i, { discountPct: pct });

  const updateItemPrice = (i: number, price: string) => {
    setReviewItems((prev) => {
      const next = [...prev];
      const item = next[i];
      const merged = { ...item, unitPrice: price, hasPrice: Number(price) > 0, priceSource: "sheet" as const };
      const total = reviewItemTotal(merged);
      const qty = Number(merged.qty ?? 1);
      const disc = Number(merged.discountPct ?? 0) / 100;
      next[i] = {
        ...merged,
        discountAmt: (qty * Number(price) * disc).toFixed(2),
        computedTotal: total.toFixed(2),
        status:
          Number(price) > 0
            ? item.hasCert ? "ok" : "no_cert"
            : item.hasCert ? "no_price" : "no_price_no_cert",
      };
      return next;
    });
  };

  // ── Step 5: create quotation ──────────────────────────────────────────────
  const handleCreate = async () => {
    setCreating(true);
    try {
      // Recalculate totals with effective discount
      const finalItems = reviewItems.map((item) => {
        const effectiveDiscPct = applyItemizeDiscount ? Number(item.discountPct ?? 0) : 0;
        const patched = { ...item, discountPct: String(effectiveDiscPct) };
        const total = reviewItemTotal(patched);
        const qty = Number(patched.qty ?? 1);
        const price = Number(patched.unitPrice ?? 0);
        const disc = effectiveDiscPct / 100;
        return {
          ...patched,
          discountAmt: (qty * price * disc).toFixed(2),
          computedTotal: total.toFixed(2),
        };
      });

      const q = await createQuotation({
        mode,
        title: sets > 1 ? `${title || "Loose Items"} X ${sets} SETS` : (title || "Loose Items"),
        sets,
        customerId: customerId || undefined,
        customerOrgMemberId: customerOrgMemberId || undefined,
        salesPersonId: salesPersonId || undefined,
        salesPersonName,
        validDays: Number(validDays),
        notes,
        deliveryTerm: deliveryTerm || undefined,
        paymentTerm: paymentTerm || undefined,
        returnPolicy: returnPolicy || undefined,
        warranty: warranty || undefined,
        items: finalItems,
        overallDiscountPct: applyTotalDiscount && discountType === "pct" ? (overallDiscount || "0") : "0",
        overallDiscountAmt: applyTotalDiscount && discountType === "fixed" ? (specialDiscAmt || "0") : undefined,
        sstPct: applySST ? sstPct || "8" : "0",
        includeCatalogue,
        includeMdaCerts,
        showTotalPrice: true,
        showItemizeDiscount: applyItemizeDiscount,
        showProductCode,
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
  const selectedCompany =
    selectedCustomer?.memberships.find((co) => co.id === customerOrgMemberId) ??
    selectedCustomer?.memberships.find((co) => co.isPrimary) ??
    selectedCustomer?.memberships[0] ??
    null;
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
  const STEPS = ["Setup", "Upload", "Review", "Generate"];

  return (
    <div className="p-6">
      <PageHeader title="New quotation" description={quotationNo} />

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
                {(() => {
                  const trimmed = customerSearch.trim();
                  const filtered = trimmed.length >= 3
                    ? customers.filter((c) => {
                        const full = [c.title, c.name].filter(Boolean).join(" ").toLowerCase();
                        const t = trimmed.toLowerCase();
                        return full.includes(t) || (c.email ?? "").toLowerCase().includes(t) || (c.contactNo ?? "").toLowerCase().includes(t);
                      })
                    : [];
                  const selectedLabel = customerId
                    ? [customers.find((c) => c.id === customerId)?.title, customers.find((c) => c.id === customerId)?.name].filter(Boolean).join(" ")
                    : "";
                  return (
                    <div className="relative">
                      <Input
                        className="h-9 text-sm"
                        placeholder={selectedLabel || "Type 3+ characters to search…"}
                        value={customerSearch}
                        onChange={(e) => {
                          setCustomerSearch(e.target.value);
                          setCustomerOpen(true);
                          if (!e.target.value) { setCustomerId(""); setCustomerCompanyId(""); }
                        }}
                        onFocus={() => setCustomerOpen(true)}
                        onBlur={() => {
                          customerBlurTimer.current = setTimeout(() => setCustomerOpen(false), 150);
                        }}
                      />
                      {customerOpen && (
                        <div className="absolute z-50 w-full mt-1 bg-background border border-border rounded-md shadow-md max-h-52 overflow-y-auto">
                          {trimmed.length < 3 ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground">Type at least 3 characters to search</div>
                          ) : filtered.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground">No customers found</div>
                          ) : (
                            filtered.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  if (customerBlurTimer.current) clearTimeout(customerBlurTimer.current);
                                  const label = [c.title, c.name].filter(Boolean).join(" ");
                                  setCustomerId(c.id);
                                  setCustomerSearch(label);
                                  setCustomerOpen(false);
                                  const primary = c.memberships.find((co) => co.isPrimary) ?? c.memberships[0];
                                  setCustomerCompanyId(primary?.id ?? "");
                                }}
                              >
                                {[c.title, c.name].filter(Boolean).join(" ")}
                                {c.contactNo && <span className="ml-2 text-xs text-muted-foreground">{c.contactNo}</span>}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </Field>

              {/* Hospital / organization selector — always shown when a customer is selected */}
              {selectedCustomer && selectedCustomer.memberships.length >= 1 && (
                <Field label="Hospital / organization">
                  <Select
                    onValueChange={setCustomerCompanyId}
                    value={customerOrgMemberId || (selectedCompany?.id ?? "")}
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
              )}

              {selectedCustomer && selectedCompany && (
                <div className="p-3 bg-muted/30 rounded-lg text-xs text-muted-foreground space-y-1">
                  <div>
                    {selectedCompany.position}
                    {selectedCompany.department
                      ? ` · ${selectedCompany.department}`
                      : ""}
                  </div>
                  <div>{selectedCompany.orgAddress}</div>
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
              <Field label="Delivery">
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
              <Field label="Return Policy">
                <Textarea
                  value={returnPolicy}
                  onChange={(e) => setReturnPolicy(e.target.value)}
                  rows={2}
                  className="text-sm resize-none"
                />
              </Field>
              <Field label="Warranty">
                <Input
                  value={warranty}
                  onChange={(e) => setWarranty(e.target.value)}
                  className="h-9 text-sm"
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
                  accept=".xlsx,.xls,.csv,.ods"
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
                          accept=".xlsx,.xls,.csv,.ods"
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
                        accept=".xlsx,.xls,.csv,.ods"
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
                          .xlsx, .csv or .ods
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
                    "OUM",
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
                    {["#", "Code", "Description", "Qty", "OUM", "Unit price", "Disc %", "Total", ""].map((h) => (
                      <th
                        key={h}
                        className={cn(
                          "px-3 py-2 text-[10px] font-medium text-muted-foreground border-b border-border",
                          ["Unit price", "Total"].includes(h) ? "text-right" : "text-left",
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const seenGroupIds = new Set<string>();
                    const rows: React.ReactNode[] = [];
                    const groupOrder: string[] = [];
                    for (const it of reviewItems) {
                      if (it.setGroupId && !seenGroupIds.has(it.setGroupId)) {
                        seenGroupIds.add(it.setGroupId);
                        groupOrder.push(it.setGroupId);
                      }
                    }

                    const renderReviewRow = (item: ReviewItem, idx: number, inSet: boolean) => {
                      const isRent = item.lineType === "rent";
                      return (
                        <tr
                          key={idx}
                          className={cn(
                            "border-b border-border/60 last:border-0",
                            item.status === "not_found" && "opacity-50",
                            inSet && "bg-blue-50/20 dark:bg-blue-900/5",
                          )}
                        >
                          {/* # + type toggle */}
                          <td className="px-3 py-1.5 w-12">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-muted-foreground text-[10px]">{item.rowNo}</span>
                              <button
                                type="button"
                                onClick={() => updateItemField(idx, { lineType: isRent ? "sell" : "rent" })}
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

                          {/* Code */}
                          <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground w-24">
                            {item.productCode ?? "—"}
                          </td>

                          {/* Description + rental + set */}
                          <td className="px-3 py-1.5 max-w-45">
                            <div className="space-y-0.5">
                              <div className="truncate">
                                {item.description}
                                {item.descriptionSource === "sheet" && (
                                  <span className="ml-1 text-[9px] text-blue-500">sheet</span>
                                )}
                              </div>
                              {isRent && (
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] text-amber-600 dark:text-amber-400">rental for</span>
                                  <input
                                    type="number"
                                    min="1"
                                    value={item.rentalDuration ?? ""}
                                    onChange={(e) => updateItemField(idx, { rentalDuration: e.target.value })}
                                    placeholder="0"
                                    className="h-5 w-12 border border-amber-200 rounded px-1 text-[10px] bg-background text-right"
                                  />
                                  <select
                                    value={item.rentalUnit ?? "case"}
                                    onChange={(e) => updateItemField(idx, { rentalUnit: e.target.value })}
                                    className="h-5 border border-amber-200 rounded px-1 text-[10px] bg-background"
                                  >
                                    {["day","week","month","year","case"].map((u) => (
                                      <option key={u} value={u}>{u}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] text-muted-foreground">Set:</span>
                                <input
                                  value={item.setGroupLabel ?? ""}
                                  onChange={(e) => {
                                    const newLabel = e.target.value;
                                    setReviewItems((prev) => {
                                      const existing = prev.find(
                                        (x, xi) => x.setGroupLabel === newLabel && xi !== idx && newLabel,
                                      );
                                      const gid = existing?.setGroupId || (newLabel ? `g-${newLabel}` : "");
                                      return prev.map((x, xi) =>
                                        xi === idx
                                          ? { ...x, setGroupLabel: newLabel, setGroupId: gid, setQty: existing?.setQty || "1" }
                                          : x,
                                      );
                                    });
                                  }}
                                  placeholder="(none)"
                                  className="h-5 w-24 border border-border rounded px-1 text-[9px] bg-background text-muted-foreground"
                                />
                              </div>
                            </div>
                          </td>

                          {/* Qty */}
                          <td className="px-3 py-1.5 w-14">
                            <div className="space-y-0.5">
                              <div className="text-center tabular-nums">{item.qty}</div>
                              {inSet && (
                                <div className="text-[9px] text-muted-foreground text-center">/set</div>
                              )}
                            </div>
                          </td>

                          {/* UOM */}
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-0.5">
                              <input
                                type="text"
                                value={item.uom ?? ""}
                                onChange={(e) => updateItemField(idx, { uom: e.target.value })}
                                className="w-14 h-6 border border-input rounded px-1.5 text-xs bg-background"
                                placeholder="—"
                              />
                              {item.uomSource === "sheet" && (
                                <span className="text-[9px] text-blue-500">s</span>
                              )}
                            </div>
                          </td>

                          {/* Unit price */}
                          <td className="px-3 py-1.5 text-right">
                            <input
                              type="number"
                              value={item.unitPrice ?? "0"}
                              onChange={(e) => updateItemPrice(idx, e.target.value)}
                              className="w-20 h-6 border border-input rounded px-1.5 text-right text-xs bg-background"
                            />
                            {item.priceSource === "sheet" && (
                              <span className="ml-0.5 text-[9px] text-blue-500">s</span>
                            )}
                          </td>

                          {/* Disc% */}
                          <td className="px-3 py-1.5">
                            <input
                              type="number"
                              value={item.discountPct ?? "0"}
                              onChange={(e) => updateItemDiscount(idx, e.target.value)}
                              className="w-14 h-6 border border-input rounded px-1.5 text-right text-xs bg-background"
                              min="0"
                              max="100"
                            />
                          </td>

                          {/* Total */}
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {fmt(item.computedTotal)}
                          </td>

                          {/* Status */}
                          <td className="px-3 py-1.5">
                            <div className={cn("flex items-center gap-1", STATUS_BADGE[item.status].className)}>
                              {STATUS_BADGE[item.status].icon}
                            </div>
                          </td>
                        </tr>
                      );
                    };

                    // Set groups
                    for (const gid of groupOrder) {
                      const gItems = reviewItems.map((it, idx) => ({ it, idx })).filter(({ it }) => it.setGroupId === gid);
                      const first = gItems[0].it;
                      const groupTotal = gItems.reduce((s, { it }) => s + Number(it.computedTotal), 0);
                      rows.push(
                        <tr key={`hdr-${gid}`} className="bg-blue-50/60 dark:bg-blue-900/10 border-b border-blue-200/60 dark:border-blue-800/40">
                          <td colSpan={3} className="px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                                {first.setGroupLabel || "Set"}
                              </span>
                              <span className="text-[10px] text-muted-foreground">×</span>
                              <input
                                type="number"
                                min="1"
                                value={first.setQty || "1"}
                                onChange={(e) =>
                                  setReviewItems((prev) =>
                                    prev.map((x) => x.setGroupId === gid ? { ...x, setQty: e.target.value } : x),
                                  )
                                }
                                className="h-5 w-12 border border-blue-200 rounded px-1 text-[10px] bg-background text-right"
                              />
                              <span className="text-[10px] text-muted-foreground">sets</span>
                            </div>
                          </td>
                          <td colSpan={4} />
                          <td className="px-3 py-1.5 text-right text-[10px] font-semibold text-blue-700 dark:text-blue-300 tabular-nums">
                            {fmt(String(groupTotal))}
                          </td>
                          <td />
                        </tr>,
                      );
                      gItems.forEach(({ it, idx }) => rows.push(renderReviewRow(it, idx, true)));
                    }

                    // Standalone
                    reviewItems.forEach((it, idx) => {
                      if (!it.setGroupId) rows.push(renderReviewRow(it, idx, false));
                    });

                    return rows;
                  })()}
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
              Next: Generate <ChevronRightIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Generate ────────────────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-4">
          {/* Pricing & discount */}
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
                {/* Itemize discount — only shown when items carry discounts */}
                {applyItemizeDiscount && (
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
                    {itemDiscTotal > 0 && (
                      <span className="text-sm text-red-600 dark:text-red-400 font-mono tabular-nums">
                        − RM {fmt(itemDiscTotal)}
                      </span>
                    )}
                  </div>
                )}

                {/* Total discount */}
                <div className="flex items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    id="applyTotalDisc"
                    checked={applyTotalDiscount}
                    onChange={(e) => setApplyTotalDiscount(e.target.checked)}
                    className="w-4 h-4 mt-0.5"
                  />
                  <div className="flex-1 space-y-2">
                    <label htmlFor="applyTotalDisc" className="text-sm font-medium cursor-pointer">
                      Apply total discount
                    </label>
                    {applyTotalDiscount && (
                      <div className="space-y-2">
                        <div className="flex gap-1">
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
                        <div className="flex items-center gap-2">
                          {discountType === "pct" ? (
                            <>
                              <Input
                                type="number"
                                value={overallDiscount}
                                onChange={(e) => setOverallDiscount(e.target.value)}
                                className="h-7 text-sm w-20 text-right"
                                min="0"
                                max="100"
                                placeholder="0"
                              />
                              <span className="text-sm text-muted-foreground">%</span>
                            </>
                          ) : (
                            <>
                              <span className="text-sm text-muted-foreground">RM</span>
                              <Input
                                type="number"
                                value={specialDiscAmt}
                                onChange={(e) => setSpecialDiscAmt(e.target.value)}
                                className="h-7 text-sm w-28 text-right"
                                min="0"
                                placeholder="0.00"
                              />
                            </>
                          )}
                          {overallDiscAmt > 0 && (
                            <span className="text-sm text-red-600 dark:text-red-400 font-mono tabular-nums">
                              − RM {fmt(overallDiscAmt)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
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
                  <span className="text-foreground">RM {fmt(subtotalNSets)}</span>
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

          {/* Generate options */}
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
                      ? [selectedCustomer.title, selectedCustomer.name].filter(Boolean).join(" ")
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
              </div>

              {/* Options */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Display</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "productcode", label: "Product code",   value: showProductCode,  set: setShowProductCode },
                    { id: "certs",       label: "MDA certificates", value: includeMdaCerts, set: setIncludeMdaCerts },
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
                    { id: "catalogue", label: "Product catalogue",                value: includeCatalogue,     set: setIncludeCatalogue },
                    { id: "mof",       label: "MOF Certificate",                  value: inclMof,              set: setInclMof },
                    { id: "ssm",       label: "SSM",                              value: inclSsm,              set: setInclSsm },
                    { id: "tcc",       label: "TCC (Tax Compliance Certificate)", value: inclTcc,              set: setInclTcc },
                    { id: "bank",      label: "Bank Statement",                   value: inclBankStatement,    set: setInclBankStatement },
                    { id: "mda",       label: "MDA Establishment",                value: inclMdaEstablishment, set: setInclMdaEstablishment },
                    { id: "lamp12",    label: "Lampiran 12",                      value: inclLampiran12,       set: setInclLampiran12 },
                    { id: "lamp13",    label: "Lampiran 13",                      value: inclLampiran13,       set: setInclLampiran13 },
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
                  {noPriceCount} item{noPriceCount > 1 ? "s" : ""} have no price — they will show RM 0.00 in the quotation.
                </div>
              )}
              {noCertCount > 0 && (
                <div className="flex items-start gap-2 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg text-xs text-orange-700 dark:text-orange-400">
                  <AlertCircleIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {noCertCount} item{noCertCount > 1 ? "s" : ""} have no MDA certificate — certificate page will be omitted for these items.
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
              onClick={() => setStep(3)}
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
