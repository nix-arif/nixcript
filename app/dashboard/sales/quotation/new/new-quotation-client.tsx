"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  matchSpreadsheetToProducts,
  createQuotation,
  updateQuotation,
  type SpreadsheetRow,
  type ReviewItem,
  type UpdateQuotationInput,
} from "@/server/quotation";
import type { PaymentOption } from "@/db/schema";
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
  DownloadIcon,
  FileSpreadsheetIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  XCircleIcon,
  XIcon,
  PencilIcon,
  DatabaseIcon,
  PlusIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { type DocumentCategoryRow } from "@/server/document-category";

type Customer = Awaited<ReturnType<typeof getCustomers>>[number];
type Member = Awaited<ReturnType<typeof getOrgMembersForQuotation>>[number];

type Step = 1 | 2 | 3;


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

export type EditData = {
  quotationId: string;
  mode: "single" | "comparison";
  title: string;
  sets: number;
  customer: Customer | null;
  customerOrgMemberId: string;
  salesPersons: { id: string; name: string; isExt: boolean }[];
  validDays: number;
  notes: string;
  deliveryTerm: string;
  paymentTerm: string;
  returnPolicy: string;
  warranty: string;
  paymentOptions: PaymentOption[];
  categoryIds: string[];
  items: ReviewItem[];
};

interface Props {
  members: Member[];
  currentUserId: string;
  currentUserName: string;
  ownerOrgs: { id: string; name: string; slug: string }[];
  activeOrgId: string;
  categories?: DocumentCategoryRow[];
  editData?: EditData;
}

export function NewQuotationClient({
  members,
  currentUserId,
  currentUserName,
  ownerOrgs,
  activeOrgId,
  categories = [],
  editData,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  // Step 1 state
  const [mode, setMode] = useState<"single" | "comparison">(editData?.mode ?? "single");
  const [title, setTitle] = useState(
    (editData?.title ?? "Loose Items").replace(/\s+[Xx]\s+\d+\s+SETS?$/i, "").trim() || "Loose Items"
  );
  const [sets, setSets] = useState(editData?.sets ?? 1);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(editData?.customer ?? null);
  const customerId = selectedCustomer?.id ?? "";
  const [customerOrgMemberId, setCustomerCompanyId] = useState(editData?.customerOrgMemberId ?? "");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const custSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customerBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spInputRef = useRef<HTMLInputElement>(null);
  const codeOnFocus = useRef<Map<number, string>>(new Map());
  const descOnFocus = useRef<Map<number, string>>(new Map());
  const [salesPersons, setSalesPersons] = useState<{ id: string; name: string; isExt: boolean }[]>(editData?.salesPersons ?? []);
  const [spInput, setSpInput] = useState("");
  const [validDays, setValidDays] = useState(String(editData?.validDays ?? 90));
  const [notes, setNotes] = useState(editData?.notes ?? "");
  const [deliveryTerm, setDeliveryTerm] = useState(editData?.deliveryTerm ?? "EX-STOCK SUBJECT PRIOR SALES, OTHERWISE 8 – 12 WEEKS");
  const [paymentTerm, setPaymentTerm] = useState(editData?.paymentTerm ?? "30 days");
  const [returnPolicy, setReturnPolicy] = useState(editData?.returnPolicy ?? "GOODS ONCE SOLD WILL NOT TAKEN BACK");
  const [warranty, setWarranty] = useState(editData?.warranty ?? "5 years against material and manufacturing defects");
  const [paymentOptions, setPaymentOptions] = useState<PaymentOption[]>(editData?.paymentOptions ?? []);
  const [categoryIds, setCategoryIds] = useState<string[]>(() =>
    editData ? editData.categoryIds : categories.filter((c) => c.isDefault).map((c) => c.id),
  );

  // Step 2 state
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<SpreadsheetRow[]>([]);
  const [parsing, setParsing] = useState(false);

  // Step 3 state
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>(editData?.items ?? []);
  const [matching, setMatching] = useState(false);
  const [autoMatching, setAutoMatching] = useState(false);

  // Step 4 state
  const [overallDiscount, setOverallDiscount] = useState("0");
  const [specialDiscAmt, setSpecialDiscAmt] = useState("0");
  const [discountType, setDiscountType] = useState<"pct" | "fixed">("pct");
  const [sstPct, setSstPct] = useState("0");
  const [applySST, setApplySST] = useState(false);
  const [applyTotalDiscount, setApplyTotalDiscount] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [lookupLoadingIdx, setLookupLoadingIdx] = useState<number | null>(null);

  // Step 5 state
  const [includeCatalogue, setIncludeCatalogue] = useState(true);
  const [includeMdaCerts, setIncludeMdaCerts] = useState(true);
  const [showProductCode, setShowProductCode] = useState(true);
  const [showItemizedPricing, setShowItemizedPricing] = useState(true);
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
    const disc = Number(item.discountPct ?? 0) / 100;
    const setMul = item.setGroupId ? Number(item.setQty || 1) : 1;
    const dur = item.lineType === "rent" ? Number(item.rentalDuration || 1) : 1;
    return s + qty * setMul * dur * price * (1 - disc);
  }, 0);
  const subtotalNSets = subtotalPerSet * sets;

  const overallDiscAmt = applyTotalDiscount
    ? discountType === "pct"
      ? subtotalNSets * (Number(overallDiscount || 0) / 100)
      : Number(specialDiscAmt || 0)
    : 0;
  const afterAllDisc = subtotalNSets - overallDiscAmt;
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

  const downloadTemplate = () => {
    const headers = ["No", "Product Code", "Description", "Set Name", "Qty", "UOM", "Unit Price"];
    const examples = [
      [1, "CODE-001", "Example Product A", "Set A", 1, "pcs", 100.00],
      [2, "CODE-002", "Example Product B", "Set A", 2, "pcs", 50.00],
      [3, "CODE-003", "Example Product C", "not-as-set", 1, "unit", 200.00],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
    ws["!cols"] = [{ wch: 5 }, { wch: 16 }, { wch: 36 }, { wch: 16 }, { wch: 6 }, { wch: 8 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Items");
    XLSX.writeFile(wb, "quotation-template.xlsx");
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
          .map((row: any, i: number) => {
            const setLabel = col(row, "Set Name", "Set name", "Set", "Group", "Paket")
              .trim().replace(/\s+/g, " ").toLowerCase();
            return {
              rowNo: parseRowNo(col(row, "No", "no", "#") || String(i + 1), i + 1),
              sku: col(row, "SKU", "sku").trim().toLowerCase(),
              productCode: col(row, "Product Code", "product_code", "ProductCode", "Code", "Kode").trim(),
              description: col(row, "Description", "Desc", "Nama", "Item", "Item Description").trim().toLowerCase(),
              qty: col(row, "Qty", "QTY", "Quantity", "Kuantiti").trim().toLowerCase() || "1",
              uom: col(row, "UOM", "OUM", "Uom", "Oum", "Unit", "Unit of Measure", "unit_of_measure", "Satuan").trim().toLowerCase(),
              unitPrice: col(row, "Unit Price", "unit_price", "UnitPrice", "Price", "Harga").trim().toLowerCase(),
              discountPct: col(row, "Disc %", "Disc", "Discount %", "Discount", "Diskaun").trim().toLowerCase(),
              totalPrice: col(row, "Total Price", "total_price", "TotalPrice", "Total").trim().toLowerCase(),
              setGroupLabel: setLabel || undefined,
              setGroupId: setLabel ? `g-${setLabel}` : undefined,
              setQty: setLabel ? "1" : undefined,
            };
          })
          .filter((r) => r.productCode || r.description);

        // If every row has no set name, normalize all to "not-as-set"
        const allEmpty = rows.every((r) => !r.setGroupLabel);
        if (allEmpty) {
          rows.forEach((r) => {
            r.setGroupLabel = "not-as-set";
            r.setGroupId = "g-not-as-set";
            r.setQty = "1";
          });
        } else {
          // Mixed: fill empty set names with "not-as-set" so they form their own group
          rows.forEach((r) => {
            if (!r.setGroupLabel) {
              r.setGroupLabel = "not-as-set";
              r.setGroupId = "g-not-as-set";
              r.setQty = "1";
            }
          });
        }

        // Validate set name contiguity
        const seenSets = new Set<string>();
        let prevSet = "";
        for (const r of rows) {
          const label = r.setGroupLabel ?? "";
          if (label !== prevSet) {
            if (label && seenSets.has(label)) {
              toast.error(`Set name "${label}" is out of order — all items in a set must be grouped together in the spreadsheet`);
              setParsing(false);
              return;
            }
            if (label) seenSets.add(label);
            prevSet = label;
          }
        }

        // Auto-populate title when all rows share a single set name
        const uniqueSetNames = new Set(rows.map((r) => r.setGroupLabel));
        if (uniqueSetNames.size === 1) {
          const [onlyName] = uniqueSetNames;
          if (onlyName) setTitle(onlyName === "not-as-set" ? "Loose Items" : onlyName);
        }

        setRawRows(rows);
        toast.success(`${rows.length} rows parsed`);
        setAutoMatching(true);
        matchSpreadsheetToProducts(rows)
          .then((items) => {
            setReviewItems(items);
          })
          .catch((e: any) => toast.error(e?.message ?? "Failed to match products"))
          .finally(() => setAutoMatching(false));
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
    const dur = item.lineType === "rent" ? Number(item.rentalDuration || 1) : 1;
    return qty * dur * price * (1 - disc);
  }

  function rowDisplayTotal(item: ReviewItem, globalSets: number): number {
    const qty = Number(item.qty ?? 1);
    const price = Number(item.unitPrice ?? 0);
    const disc = Number(item.discountPct ?? 0) / 100;
    const dur = item.lineType === "rent" ? Number(item.rentalDuration || 1) : 1;
    const setMul = item.setGroupId ? Number(item.setQty || 1) : 1;
    return qty * dur * price * (1 - disc) * setMul * globalSets;
  }

  const addRow = () => {
    const maxRowNo = reviewItems.reduce((max, it) => Math.max(max, Number(it.rowNo) || 0), 0);
    const uniqueGroups = [...new Set(reviewItems.map((it) => it.setGroupId).filter(Boolean))];
    const singleGroup = uniqueGroups.length === 1
      ? reviewItems.find((it) => it.setGroupId === uniqueGroups[0])
      : null;
    const multiGroup = uniqueGroups.length > 1;
    const newItem: ReviewItem = {
      rowNo: String(maxRowNo + 1),
      qty: "1",
      unitPrice: "0",
      discountPct: "0",
      discountAmt: "0",
      computedTotal: "0",
      lineType: "sell",
      hasPrice: false,
      hasCert: false,
      descriptionSource: "user",
      priceSource: "user",
      uomSource: "db",
      status: "no_price_no_cert",
      ...(singleGroup && {
        setGroupId: singleGroup.setGroupId,
        setGroupLabel: singleGroup.setGroupLabel,
        setQty: singleGroup.setQty,
      }),
      ...(multiGroup && {
        setGroupId: "g-not-as-set",
        setGroupLabel: "not-as-set",
        setQty: "1",
      }),
    };
    setReviewItems((prev) => [...prev, newItem]);
  };

  const removeItem = (i: number) => {
    setReviewItems((prev) => prev.filter((_, idx) => idx !== i));
  };

  const CELL_COLS = 4; // code=0, description=1, qty=2, unitPrice=3
  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    row: number,
    col: number,
  ) => {
    if (!e.metaKey && !e.ctrlKey) return;
    let targetRow = row;
    let targetCol = col;
    if (e.key === "ArrowRight") targetCol = col + 1;
    else if (e.key === "ArrowLeft") targetCol = col - 1;
    else if (e.key === "ArrowDown") targetRow = row + 1;
    else if (e.key === "ArrowUp") targetRow = row - 1;
    else return;
    if (targetCol < 0 || targetCol >= CELL_COLS) return;
    if (targetRow < 0 || targetRow >= reviewItems.length) return;
    e.preventDefault();
    const el = document.querySelector<HTMLElement>(
      `[data-row="${targetRow}"][data-col="${targetCol}"]`,
    );
    el?.focus();
  };

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


  const updateItemPrice = (i: number, price: string) => {
    setReviewItems((prev) => {
      const next = [...prev];
      const item = next[i];
      const merged = { ...item, unitPrice: price, hasPrice: Number(price) > 0, priceSource: "user" as const };
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

  const handleCodeBlur = async (idx: number, code: string) => {
    if (!code.trim()) return;
    const priorCode = codeOnFocus.current.get(idx);
    if (priorCode !== undefined && priorCode === code.trim()) return;
    setLookupLoadingIdx(idx);
    try {
      const item = reviewItems[idx];
      const row: SpreadsheetRow = {
        rowNo: item.rowNo,
        productCode: code.trim(),
        description: "",
        qty: item.qty,
        uom: "",
        unitPrice: "",
        discountPct: item.discountPct,
        lineType: item.lineType,
        rentalDuration: item.rentalDuration,
        rentalUnit: item.rentalUnit,
        setGroupId: item.setGroupId,
        setGroupLabel: item.setGroupLabel,
        setQty: item.setQty,
      };
      const [matched] = await matchSpreadsheetToProducts([row]);
      if (matched?.productId) {
        setReviewItems((prev) =>
          prev.map((x, i) => {
            if (i !== idx) return x;
            const updated = {
              ...matched,
              qty: x.qty,
              setQty: x.setQty,
              setGroupId: x.setGroupId,
              setGroupLabel: x.setGroupLabel,
              discountPct: x.discountPct,
              computedTotal: reviewItemTotal(matched).toFixed(2),
            };
            return updated;
          }),
        );
      } else {
        setReviewItems((prev) =>
          prev.map((x, i) =>
            i !== idx
              ? x
              : {
                  ...x,
                  description: "N/A",
                  descriptionSource: "user" as const,
                  productId: undefined,
                  productName: undefined,
                  status: "not_found" as const,
                  hasPrice: false,
                  hasCert: false,
                },
          ),
        );
      }
    } catch {
      // silently ignore network errors
    } finally {
      setLookupLoadingIdx(null);
    }
  };

  // ── Step 5: create / update quotation ────────────────────────────────────
  const handleCreate = async () => {
    if (!customerId) { toast.error("Please select a customer"); return; }
    if (salesPersons.length === 0) { toast.error("Please add at least one sales person"); return; }
    setCreating(true);
    try {
      const finalItems = reviewItems.map((item) => {
        const total = reviewItemTotal(item);
        const qty = Number(item.qty ?? 1);
        const price = Number(item.unitPrice ?? 0);
        const disc = Number(item.discountPct ?? 0) / 100;
        return {
          ...item,
          discountAmt: (qty * price * disc).toFixed(2),
          computedTotal: total.toFixed(2),
        };
      });

      const sharedInput = {
        title: title || "Loose Items",
        sets,
        customerId: customerId || undefined,
        customerOrgMemberId: customerOrgMemberId || undefined,
        salesPersonId: salesPersons.find((s) => !s.isExt)?.id || undefined,
        salesPersonName: salesPersons[0]?.name || undefined,
        associateSalesPersons: salesPersons.length > 1 ? salesPersons.slice(1).map(({ id, name }) => ({ id, name })) : null,
        validDays: Number(validDays),
        notes,
        deliveryTerm,
        paymentTerm,
        returnPolicy,
        warranty,
        paymentOptions: paymentOptions.length ? paymentOptions : null,
        items: finalItems,
        overallDiscountPct: applyTotalDiscount && discountType === "pct" ? (overallDiscount || "0") : "0",
        overallDiscountAmt: applyTotalDiscount && discountType === "fixed" ? (specialDiscAmt || "0") : undefined,
        sstPct: applySST ? sstPct || "8" : "0",
        includeCatalogue,
        includeMdaCerts,
        showTotalPrice: true,
        showItemizeDiscount: false,
        showProductCode,
        showItemizedPricing,
        inclMof,
        inclSsm,
        inclTcc,
        inclBankStatement,
        inclMdaEstablishment,
        inclLampiran12,
        inclLampiran13,
        categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
      };

      if (editData) {
        await updateQuotation(editData.quotationId, sharedInput as UpdateQuotationInput);
        toast.success("Quotation updated");
        router.push(`/dashboard/sales/quotation/${editData.quotationId}`);
      } else {
        const q = await createQuotation({ mode, ...sharedInput });
        if (!q) throw new Error("Failed to create quotation");
        toast.success(`Quotation ${q.quotationNo} created`);
        router.push(`/dashboard/sales/quotation/${q.id}`);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

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
  const STEPS = ["Setup", "Upload", "Review"];

  return (
    <div className="p-6">
      <PageHeader title={editData ? "Edit quotation" : "New quotation"} />

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
                  onClick={() => !editData && !("disabled" in opt && opt.disabled) && setMode(opt.value)}
                  disabled={!!editData || ("disabled" in opt && opt.disabled)}
                  className={cn(
                    "p-3 rounded-lg border text-left transition-all",
                    mode === opt.value
                      ? "border-2 border-primary bg-primary/5"
                      : "border border-border hover:border-border",
                    (!!editData || ("disabled" in opt && opt.disabled))
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

          {/* Card 1: Customer */}
          <div className="bg-background border border-border rounded-xl">
            <div className="px-4 py-3 bg-muted/20 border-b border-border rounded-t-xl">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Customer<span className="text-destructive ml-0.5 normal-case">*</span>
              </div>
            </div>
            <div className="p-4 space-y-4">
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
                          if (!val) { setSelectedCustomer(null); setCustomerCompanyId(""); setCustResults([]); return; }
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
                                  setCustomerCompanyId(primary?.id ?? "");
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

              {/* Hospital / organization selector — always shown when a customer is selected */}
              {selectedCustomer && selectedCustomer.memberships.length >= 1 && (
                <Field label="Hospital / organization">
                  <Select
                    key={selectedCustomer.id}
                    onValueChange={setCustomerCompanyId}
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
                    value={validDays}
                    onChange={(e) => setValidDays(e.target.value)}
                    className="h-9 text-sm w-20 text-right"
                    min="1"
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
              {/* Read-only meta */}
              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border/60">
                <div className="space-y-0.5">
                  <p className="text-[11px] text-muted-foreground">Prepared by</p>
                  <p className="text-sm">{currentUserName}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[11px] text-muted-foreground">Quotation no.</p>
                  <p className="text-sm text-muted-foreground italic">Assigned on finalize</p>
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

              {/* Payment Options */}
              <div className="mt-4 border-t border-border pt-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Payment Options</span>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showItemizedPricing}
                        onChange={(e) => setShowItemizedPricing(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-primary"
                      />
                      <span className="text-xs text-muted-foreground">Show itemized pricing</span>
                    </label>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() =>
                      setPaymentOptions((prev) => [
                        ...prev,
                        prev.length === 0
                          ? { type: "lump_sum", label: "Option 1 — Full Payment", note: "" }
                          : { type: "instalment", label: "Option 2 — Instalment", deposit: "", monthly: "", months: 12, lastMonth: "", note: "" },
                      ])
                    }
                  >
                    + Add Option
                  </Button>
                </div>

                {paymentOptions.length === 0 && (
                  <p className="text-xs text-muted-foreground">No payment options — the standard Payment Terms field above will be used.</p>
                )}

                {paymentOptions.map((opt, idx) => (
                  <div key={idx} className="border border-border rounded-lg p-3 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <Input
                        value={opt.label}
                        onChange={(e) => setPaymentOptions((prev) => prev.map((o, i) => i === idx ? { ...o, label: e.target.value } : o))}
                        placeholder="Option label"
                        className="h-8 text-sm flex-1"
                      />
                      <select
                        value={opt.type}
                        onChange={(e) => {
                          const t = e.target.value as PaymentOption["type"];
                          setPaymentOptions((prev) => prev.map((o, i) => {
                            if (i !== idx) return o;
                            return t === "lump_sum"
                              ? { type: "lump_sum", label: o.label, discountPct: undefined, note: o.note }
                              : { type: "instalment", label: o.label, deposit: "", monthly: "", months: 12, lastMonth: "", note: o.note };
                          }));
                        }}
                        className="h-8 text-sm border border-border rounded-md px-2 bg-background"
                      >
                        <option value="lump_sum">Full Payment</option>
                        <option value="instalment">Instalment</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => setPaymentOptions((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <XIcon className="w-4 h-4" />
                      </button>
                    </div>

                    {opt.type === "lump_sum" && (
                      <div className="flex items-end gap-3">
                        <div className="space-y-1 w-36">
                          <label className="text-xs text-muted-foreground">Discount (%)</label>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={opt.discountPct ?? ""}
                            onChange={(e) => setPaymentOptions((prev) => prev.map((o, i) =>
                              i === idx ? { ...o, discountPct: e.target.value !== "" ? Number(e.target.value) : undefined } : o
                            ))}
                            placeholder="e.g. 10"
                            className="h-8 text-sm"
                          />
                        </div>
                        {grandTotal > 0 && (
                          <p className="text-xs text-muted-foreground pb-1.5">
                            {opt.discountPct
                              ? <>Pay <span className="font-semibold text-foreground">RM {(grandTotal * (1 - opt.discountPct / 100)).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span> ({opt.discountPct}% off RM {grandTotal.toLocaleString("en-MY", { minimumFractionDigits: 2 })})</>
                              : <>Full: RM {grandTotal.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</>
                            }
                          </p>
                        )}
                      </div>
                    )}

                    {opt.type === "instalment" && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-4 gap-2">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Deposit (RM)</label>
                            <Input
                              value={opt.deposit}
                              onChange={(e) => setPaymentOptions((prev) => prev.map((o, i) => i === idx ? { ...o, deposit: e.target.value } : o))}
                              placeholder="e.g. 3000"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Monthly (RM)</label>
                            <Input
                              value={opt.monthly}
                              onChange={(e) => setPaymentOptions((prev) => prev.map((o, i) => i === idx ? { ...o, monthly: e.target.value } : o))}
                              placeholder="e.g. 900"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Months</label>
                            <Input
                              type="number"
                              min={1}
                              value={opt.months}
                              onChange={(e) => setPaymentOptions((prev) => prev.map((o, i) => i === idx ? { ...o, months: Number(e.target.value) || 1 } : o))}
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Last Month (RM)</label>
                            <Input
                              value={opt.lastMonth ?? ""}
                              onChange={(e) => setPaymentOptions((prev) => prev.map((o, i) => i === idx ? { ...o, lastMonth: e.target.value } : o))}
                              placeholder="optional"
                              className="h-8 text-sm"
                            />
                          </div>
                        </div>
                        {opt.deposit && opt.monthly && opt.months > 0 && (() => {
                          const regularMonths = opt.lastMonth ? opt.months - 1 : opt.months;
                          const total = Number(opt.deposit) + Number(opt.monthly) * regularMonths + (opt.lastMonth ? Number(opt.lastMonth) : 0);
                          const breakdown = opt.lastMonth
                            ? `deposit + RM ${Number(opt.monthly).toLocaleString("en-MY", { minimumFractionDigits: 2 })} × ${regularMonths} months + last month RM ${Number(opt.lastMonth).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`
                            : `deposit + RM ${Number(opt.monthly).toLocaleString("en-MY", { minimumFractionDigits: 2 })} × ${opt.months} months`;
                          return (
                            <p className="text-xs text-muted-foreground">
                              Total payable: <span className="font-semibold text-foreground">RM {total.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>
                              <span className="ml-1">({breakdown})</span>
                            </p>
                          );
                        })()}
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Note (optional)</label>
                      <Input
                        value={opt.note ?? ""}
                        onChange={(e) => setPaymentOptions((prev) => prev.map((o, i) => i === idx ? { ...o, note: e.target.value } : o))}
                        placeholder="e.g. Upon signing of agreement"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => {
              if (!customerId) { toast.error("Please select a customer"); return; }
              if (salesPersons.length === 0) { toast.error("Please add at least one sales person"); return; }
              setStep(2);
            }} className="gap-2">
              {editData && reviewItems.length > 0 ? "Next: Edit items" : "Next: Upload spreadsheet"} <ChevronRightIcon className="w-4 h-4" />
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
              {editData && reviewItems.length > 0 && rawRows.length === 0 && (
                <div className="flex items-center gap-3 p-3 border border-green-300 bg-green-50 dark:bg-green-900/10 rounded-lg">
                  <CheckCircleIcon className="w-5 h-5 text-green-600 shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-green-700 dark:text-green-400">
                      {reviewItems.length} items loaded
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Upload a new spreadsheet below to replace all items, or continue to review.
                    </div>
                  </div>
                </div>
              )}
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
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-muted-foreground">Expected columns</div>
                  <button
                    type="button"
                    onClick={downloadTemplate}
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    <DownloadIcon className="w-3 h-3" /> Download template
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "No",
                    "Product Code",
                    "Description",
                    "Set Name",
                    "Qty",
                    "UOM",
                    "Unit Price",
                  ].map((col) => (
                    <span
                      key={col}
                      className={`text-[11px] bg-background border rounded px-2 py-0.5 font-mono ${col === "Set Name" ? "border-blue-400 text-blue-600 dark:text-blue-400" : "border-border"}`}
                    >
                      {col}
                    </span>
                  ))}
                </div>
                <div className="text-[11px] text-muted-foreground mt-2">
                  Product Code is the key field. Set Name is required — use <span className="font-mono">not-as-set</span> for ungrouped items.
                </div>
              </div>
            </div>
          </div>

          {(autoMatching || reviewItems.length === 0) && (
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                className="gap-2"
                disabled={autoMatching}
              >
                <ChevronLeftIcon className="w-4 h-4" /> Back
              </Button>
              {autoMatching ? (
                <Button disabled className="gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Matching products...
                </Button>
              ) : editData && editData.items.length > 0 && rawRows.length === 0 ? (
                <Button onClick={() => setStep(3)} className="gap-2">
                  Next: Review <ChevronRightIcon className="w-4 h-4" />
                </Button>
              ) : (
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
              )}
            </div>
          )}
        </div>
      )}

      {/* ── STEP 3: Review — also shows inline in Step 2 after auto-match ────── */}
      {(step === 3 || (step === 2 && reviewItems.length > 0)) && (
        <div className="space-y-4">
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {step === 2 ? "Edit items" : "Review items"}
                  </div>
                  {step === 2 && (
                    <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 font-medium">
                      editable
                    </span>
                  )}
                  {step === 3 && (
                    <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-medium">
                      read-only
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {reviewItems.length} items{sets > 1 ? ` · ${sets} sets` : ""}
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
            <div className="px-4 py-3 border-b border-border flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-48 space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">Title (shown on document)</label>
                {step === 2 ? (
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Loose Items, Medical Equipment Supply..."
                    className="h-8 text-sm"
                  />
                ) : (
                  <div className="text-sm font-medium">{title || "—"}</div>
                )}
              </div>
              {new Set(reviewItems.map((i) => i.setGroupId).filter(Boolean)).size <= 1 && (
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-muted-foreground">Sets</label>
                  {step === 2 ? (
                    <Input
                      type="number"
                      value={sets}
                      onChange={(e) => setSets(Math.max(1, Number(e.target.value) || 1))}
                      className="h-8 text-sm w-20"
                      min="1"
                    />
                  ) : (
                    <div className="text-sm font-medium">{sets}</div>
                  )}
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse [&_td]:align-top">
                <thead>
                  <tr className="bg-muted/20">
                    {["#", "CODE", "DESCRIPTION", "QTY/SET", "TOTAL QTY", "UOM", "UNIT PRICE", "TOTAL", "STATUS"].map((h) => (
                      <th
                        key={h}
                        className={cn(
                          "px-3 py-2 text-[10px] font-semibold tracking-wide text-muted-foreground border-b border-border",
                          ["UNIT PRICE", "TOTAL", "TOTAL QTY", "QTY/SET"].includes(h) ? "text-right" : "text-left",
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const isEditable = step === 2;
                    const seenGroupIds = new Set<string>();
                    const rows: React.ReactNode[] = [];
                    const groupOrder: string[] = [];
                    for (const it of reviewItems) {
                      if (it.setGroupId && !seenGroupIds.has(it.setGroupId)) {
                        seenGroupIds.add(it.setGroupId);
                        groupOrder.push(it.setGroupId);
                      }
                    }

                    const renderSourceTag = (source: "db" | "sheet" | "user" | undefined) => {
                      if (!isEditable) return null;
                      if (source === "db") return (
                        <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md mt-0.5 bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                          <DatabaseIcon className="w-2.5 h-2.5 shrink-0" />from product table
                        </span>
                      );
                      if (source === "user" || source === "sheet") return (
                        <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md mt-0.5 bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                          <PencilIcon className="w-2.5 h-2.5 shrink-0" />{currentUserName} edited
                        </span>
                      );
                      return null;
                    };

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
                          {/* # + type */}
                          <td className="px-3 py-1.5 w-12">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-muted-foreground text-[10px]">{item.rowNo}</span>
                              {isEditable ? (
                                <button
                                  type="button"
                                  aria-label="Toggle sell or rent"
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
                              ) : (
                                <span className={cn(
                                  "text-[9px] font-bold px-1.5 py-0.5 rounded border",
                                  isRent
                                    ? "bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400"
                                    : "bg-green-50 border-green-300 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400",
                                )}>
                                  {isRent ? "RENT" : "SELL"}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Code */}
                          <td className="px-3 py-1.5 w-28">
                            {isEditable ? (
                              <div>
                                <div className="relative">
                                  <input
                                    type="text"
                                    aria-label="Product code"
                                    value={item.productCode ?? ""}
                                    data-row={idx}
                                    data-col={0}
                                    onFocus={() => codeOnFocus.current.set(idx, item.productCode?.trim() ?? "")}
                                    onChange={(e) => {
                                      updateItemField(idx, { productCode: e.target.value || undefined, productId: undefined });
                                    }}
                                    onBlur={(e) => handleCodeBlur(idx, e.target.value)}
                                    onKeyDown={(e) => handleCellKeyDown(e, idx, 0)}
                                    placeholder="—"
                                    className="w-full h-6 border border-input rounded px-1.5 text-xs font-mono bg-background pr-5"
                                  />
                                  {lookupLoadingIdx === idx && (
                                    <span className="absolute right-1 top-1 w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin text-muted-foreground" />
                                  )}
                                </div>
                                {renderSourceTag(item.productCode ? "sheet" : undefined)}
                              </div>
                            ) : (
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {item.productCode ?? "—"}
                              </span>
                            )}
                          </td>

                          {/* Description */}
                          <td className="px-3 py-1.5 min-w-70">
                            <div className="space-y-0.5">
                              {isEditable ? (
                                <>
                                  <input
                                    type="text"
                                    aria-label="Description"
                                    value={item.description ?? ""}
                                    data-row={idx}
                                    data-col={1}
                                    onFocus={() => descOnFocus.current.set(idx, item.description ?? "")}
                                    onChange={(e) => updateItemField(idx, { description: e.target.value })}
                                    onBlur={(e) => {
                                      const prev = descOnFocus.current.get(idx);
                                      if (prev !== undefined && e.target.value !== prev) {
                                        updateItemField(idx, { descriptionSource: "user" });
                                      }
                                    }}
                                    onKeyDown={(e) => handleCellKeyDown(e, idx, 1)}
                                    placeholder="Item description"
                                    className="w-full h-6 border border-input rounded px-1.5 text-xs bg-background"
                                  />
                                  {renderSourceTag(item.descriptionSource)}
                                </>
                              ) : (
                                <div className="whitespace-normal wrap-break-word">
                                  {item.description || "—"}
                                </div>
                              )}
                              {isEditable && isRent && (
                                <div className="flex items-center gap-1 mt-0.5">
                                  <span className="text-[10px] text-amber-600 dark:text-amber-400">rental for</span>
                                  <input
                                    type="number"
                                    min="1"
                                    aria-label="Rental duration"
                                    value={item.rentalDuration ?? ""}
                                    onChange={(e) => updateItemField(idx, { rentalDuration: e.target.value })}
                                    placeholder="0"
                                    className="h-5 w-12 border border-amber-200 rounded px-1 text-[10px] bg-background text-right"
                                  />
                                  <select
                                    aria-label="Rental unit"
                                    value={item.rentalUnit ?? "month"}
                                    onChange={(e) => updateItemField(idx, { rentalUnit: e.target.value })}
                                    className="h-5 border border-amber-200 rounded px-1 text-[10px] bg-background"
                                  >
                                    {["day","week","month","year","case"].map((u) => (
                                      <option key={u} value={u}>{u}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              {!isEditable && isRent && item.rentalDuration && (
                                <div className="text-[10px] text-amber-600 dark:text-amber-400">
                                  rental · {item.rentalDuration} {item.rentalUnit}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Qty/Set */}
                          <td className="px-3 py-1.5 w-16">
                            {isEditable ? (
                              <input
                                type="number"
                                min="0"
                                aria-label="Quantity per set"
                                data-row={idx}
                                data-col={2}
                                value={item.qty ?? "1"}
                                onChange={(e) => updateItemField(idx, { qty: e.target.value || "1" })}
                                onKeyDown={(e) => handleCellKeyDown(e, idx, 2)}
                                className="w-14 h-6 border border-input rounded px-1.5 text-right text-xs bg-background tabular-nums"
                              />
                            ) : (
                              <div className="text-right tabular-nums">{item.qty}</div>
                            )}
                          </td>

                          {/* Total Qty */}
                          <td className="px-3 py-1.5 w-16 text-right tabular-nums">
                            {Number(item.qty ?? 1) * (item.setGroupId ? Number(item.setQty || 1) : 1) * sets}
                          </td>

                          {/* UOM */}
                          <td className="px-3 py-1.5 w-14 text-center text-xs text-muted-foreground">
                            {item.uom || "—"}
                          </td>

                          {/* Unit price */}
                          <td className="px-3 py-1.5 text-right">
                            {isEditable ? (
                              <div className="flex flex-col items-end">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  aria-label="Unit price"
                                  data-row={idx}
                                  data-col={3}
                                  value={item.unitPrice ?? "0"}
                                  onChange={(e) => updateItemPrice(idx, e.target.value)}
                                  onKeyDown={(e) => handleCellKeyDown(e, idx, 3)}
                                  className="w-24 h-6 border border-input rounded px-1.5 text-right text-xs bg-background tabular-nums"
                                />
                                {renderSourceTag(item.priceSource)}
                              </div>
                            ) : (
                              <span className="tabular-nums">{fmt(item.unitPrice ?? "0")}</span>
                            )}
                          </td>

                          {/* Total */}
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {fmt(String(rowDisplayTotal(item, sets)))}
                          </td>

                          {/* Status + delete */}
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              <div className={cn("flex items-center gap-1", STATUS_BADGE[item.status].className)}>
                                {STATUS_BADGE[item.status].icon}
                                <span className="text-[10px]">{STATUS_BADGE[item.status].label}</span>
                              </div>
                              {isEditable && (
                                <button
                                  type="button"
                                  onClick={() => removeItem(idx)}
                                  className="ml-auto text-muted-foreground hover:text-destructive transition-colors"
                                  aria-label="Delete row"
                                >
                                  <XIcon className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    };

                    // Set groups
                    for (const gid of groupOrder) {
                      const gItems = reviewItems.map((it, idx) => ({ it, idx })).filter(({ it }) => it.setGroupId === gid);
                      const first = gItems[0].it;
                      const groupTotal = gItems.reduce((s, { it }) => s + rowDisplayTotal(it, sets), 0);
                      const groupPricePerSet = gItems.reduce((s, { it }) => s + rowDisplayTotal(it, 1), 0);
                      rows.push(
                        <tr key={`hdr-${gid}`} className="bg-blue-50/60 dark:bg-blue-900/10 border-b border-blue-200/60 dark:border-blue-800/40">
                          <td colSpan={3} className="px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-semibold tracking-wide text-blue-700 dark:text-blue-300">
                                {(first.setGroupLabel || "SET").toUpperCase()}
                              </span>
                              {groupOrder.length > 1 && (
                                <>
                                  <span className="text-[10px] text-muted-foreground">×</span>
                                  {isEditable ? (
                                    <input
                                      type="number"
                                      min="1"
                                      aria-label="Set quantity"
                                      value={first.setQty || "1"}
                                      onChange={(e) => {
                                        const newQty = e.target.value || "1";
                                        setReviewItems((prev) =>
                                          prev.map((x) =>
                                            x.setGroupId !== gid ? x : { ...x, setQty: newQty },
                                          ),
                                        );
                                      }}
                                      className="h-5 w-12 border border-blue-200 rounded px-1 text-[10px] bg-background text-right"
                                    />
                                  ) : (
                                    <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                                      {first.setQty || "1"}
                                    </span>
                                  )}
                                  <span className="text-[10px] text-muted-foreground">sets</span>
                                </>
                              )}
                            </div>
                          </td>
                          <td colSpan={3} />
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            <div className="text-[10px] font-mono text-blue-600 dark:text-blue-400">
                              {fmt(String(groupPricePerSet))}
                            </div>
                            <div className="text-[9px] text-muted-foreground">/ set</div>
                          </td>
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

            {step === 2 && (
              <div className="px-4 pt-2">
                <button
                  type="button"
                  onClick={addRow}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded px-3 py-1.5 w-full justify-center hover:border-foreground/40 transition-colors"
                >
                  <PlusIcon className="w-3.5 h-3.5" /> Add row
                </button>
              </div>
            )}

            {/* Overall price summary */}
            <div className="mt-3 flex justify-end px-4 pb-2">
              <div className="w-80 space-y-1.5 text-xs">
                {/* Price/set + sets breakdown */}
                {sets > 1 && (
                  <>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Price / set</span>
                      <span className="font-mono tabular-nums">{fmt(String(subtotalPerSet))}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>× {sets} sets</span>
                      <span className="font-mono tabular-nums">{fmt(String(subtotalNSets))}</span>
                    </div>
                  </>
                )}
                {/* Overall discount */}
                {overallDiscAmt > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Discount</span>
                    <span className="font-mono tabular-nums text-red-500">− {fmt(String(overallDiscAmt))}</span>
                  </div>
                )}
                {/* Net amount bridge — only when SST follows a discount */}
                {sstAmt > 0 && overallDiscAmt > 0 && (
                  <div className="flex justify-between text-muted-foreground border-t border-dashed pt-1.5">
                    <span>Net amount</span>
                    <span className="font-mono tabular-nums">{fmt(String(afterAllDisc))}</span>
                  </div>
                )}
                {/* SST */}
                {sstAmt > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>SST ({sstPct || 8}%)</span>
                    <span className="font-mono tabular-nums">{fmt(String(sstAmt))}</span>
                  </div>
                )}
                {/* Grand Total */}
                <div className="flex justify-between items-baseline border-t border-border pt-2">
                  <div>
                    <div className="font-semibold text-sm">Grand Total</div>
                    {sets > 1 && (
                      <div className="text-[10px] text-muted-foreground">
                        {fmt(String(grandTotal / sets))} / set
                      </div>
                    )}
                  </div>
                  <span className="font-mono tabular-nums font-bold text-base">{fmt(String(grandTotal))}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Remarks */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Remarks</div>
            </div>
            <div className="p-4">
              {step === 2 ? (
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. As per discussion on 12 May 2025..."
                  rows={2}
                  className="text-sm resize-none"
                />
              ) : notes ? (
                <p className="text-sm whitespace-pre-wrap">{notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">No remarks</p>
              )}
            </div>
          </div>

          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => step === 2 ? setStep(1) : setStep(2)}
              className="gap-2"
            >
              <ChevronLeftIcon className="w-4 h-4" /> Back
            </Button>
            {step === 2 ? (
              <Button onClick={() => setStep(3)} className="gap-2">
                Next: Review <ChevronRightIcon className="w-4 h-4" />
              </Button>
            ) : (
              <Button onClick={handleCreate} disabled={creating} className="gap-2 h-10">
                {creating && <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                {editData ? "Save changes" : "Create quotation"}
              </Button>
            )}
          </div>
        </div>
      )}

    </div>  );
}
