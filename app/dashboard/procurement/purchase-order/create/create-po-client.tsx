"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  createPurchaseOrder,
  getSalesOrderItemsForPo,
  getPoSupplierQuotationUploadUrl,
  type PrForPoConversion,
} from "@/server/purchase-order";
import { getProductDetailsByCodes } from "@/server/products";
import type { Supplier } from "@/server/supplier";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import {
  ArrowLeftIcon,
  PaperclipIcon,
  XIcon,
  SearchIcon,
  ClipboardListIcon,
  LinkIcon,
  UploadIcon,
  AlertCircleIcon,
  InfoIcon,
  PencilIcon,
} from "lucide-react";
import { Highlight } from "@/components/highlight";
import { uid } from "@/lib/uid";
import {
  type LineItem,
  newLine,
  calcTotals,
  CURRENCIES,
  detectCurrency,
  fmt,
  useUpdateItem,
  useAddLine,
  useRemoveLine,
  useHandleProductCodeBlur,
  useItemImageHandlers,
  useCleanupOrphanedImages,
  PoItemsTable,
} from "../_shared/po-item-fields";

interface ApprovedSo { id: string; soNo: string; customerName: string | null }
interface CustomerPoOption { id: string; customerPoNo: string; customerName: string | null; amount: string }

interface Props {
  suppliers: Supplier[];
  defaultDeliveryAddress?: string;
  backHref?: string;
  currentUserName?: string;
  businessType?: string;
  // Direct creation mode
  approvedSos?: ApprovedSo[];
  customerPos?: CustomerPoOption[];
  initialSoId?: string;
  // PR conversion mode
  prData?: PrForPoConversion;
}

function prItemToLine(pi: PrForPoConversion["items"][number]): LineItem {
  return {
    _key: pi.id, // stable DB id — safe for SSR
    rowNo: pi.rowNo,
    productId: pi.productId ?? undefined,
    productCode: pi.productCode ?? "",
    description: pi.description ?? "",
    qty: pi.qty,
    uom: pi.uom ?? "",
    unitPrice: pi.estimatedUnitCost,
    currency: pi.currency,
    totalPrice: (parseFloat(pi.qty) * parseFloat(pi.estimatedUnitCost)).toFixed(2),
    imageKey: pi.imageKey ?? undefined,
    _imageInherited: !!pi.imageKey,
    _imagePreviewUrl: pi.imageUrl ?? undefined,
    descriptionSource: pi.description ? "pr" : undefined,
    customerName: pi.customerName ?? "",
    customerOrganization: pi.customerOrganization ?? "",
    customerPoNo: pi.cpoNo ?? "",
    _cpoId: pi.cpoId ?? null,
    isAdditional: pi.isAdditional,
    editedBy: pi.editedBy ?? undefined,
  };
}

export function CreatePurchaseOrderClient({ suppliers, approvedSos = [], customerPos = [], initialSoId, prData, defaultDeliveryAddress = "", backHref: backHrefProp, currentUserName = "", businessType = "trading" }: Props) {
  const showSourcing = businessType !== "trading";
  const router = useRouter();
  const isPrMode = !!prData;

  // Keep original PR items for re-filtering when supplier changes
  const prItemsRef = useRef(prData?.items ?? []);

  // Derive initial supplier: pre-select only when all PR items share exactly one preferred supplier
  const initialSupplierId = (() => {
    if (!prData) return "";
    const ids = [...new Set(prData.items.map((i) => i.preferredSupplierId).filter(Boolean))];
    return ids.length === 1 ? (ids[0] ?? "") : "";
  })();

  const [supplierId, setSupplierId] = useState(initialSupplierId);

  // Linked SO (direct mode only)
  const [selectedSo, setSelectedSo] = useState<ApprovedSo | null>(() =>
    initialSoId ? (approvedSos.find((s) => s.id === initialSoId) ?? null) : null,
  );
  const [soSearch, setSoSearch] = useState("");
  // Tracks what's already ordered for the selected SO
  const [orderedSupplierIds, setOrderedSupplierIds] = useState<string[]>([]);
  const [orderedProductCodes, setOrderedProductCodes] = useState<string[]>([]);

  // Linked Customer POs (direct mode only)
  const [selectedCpos, setSelectedCpos] = useState<CustomerPoOption[]>([]);
  const [cpoSearch, setCpoSearch] = useState("");

  // Header fields
  const [deliveryDate, setDeliveryDate] = useState(() => {
    if (prData?.soDeliveryDate) return new Date(prData.soDeliveryDate).toISOString().split("T")[0];
    return "";
  });
  const [deliveryAddress, setDeliveryAddress] = useState(
    prData?.soDeliveryAddress ?? defaultDeliveryAddress,
  );
  const deliveryDateInherited = prData?.soDeliveryDate
    ? new Date(prData.soDeliveryDate).toISOString().split("T")[0]
    : "";
  const deliveryAddressInherited = prData?.soDeliveryAddress ?? "";
  const [notes, setNotes] = useState(prData?.notes ?? "");
  const [useManualPoNo, setUseManualPoNo] = useState(false);
  const [manualPoNo, setManualPoNo] = useState("");
  const [importingSheet, setImportingSheet] = useState(false);
  const [sstPct, setSstPct] = useState("0");
  const [currency, setCurrency] = useState(() => {
    if (prData) return detectCurrency(prData.items);
    return "MYR";
  });

  function handleCurrencyChange(next: string) {
    setCurrency(next);
    setItems((prev) => prev.map((i) => ({ ...i, currency: next })));
  }

  // Items — in PR mode: filtered by selected supplier; in direct mode: manual or from SO
  const [items, setItems] = useState<LineItem[]>(() => {
    if (isPrMode) {
      if (!initialSupplierId) return [];
      return prItemsRef.current
        .filter((pi) => !pi.preferredSupplierId || pi.preferredSupplierId === initialSupplierId)
        .map((pi) => prItemToLine(pi));
    }
    return [newLine(1)];
  });
  const [loadingSoItems, setLoadingSoItems] = useState(false);

  // Supplier change: in PR mode, re-filter items by the new supplier
  function handleSupplierChange(newId: string) {
    setSupplierId(newId);
    if (!isPrMode) return;
    if (!newId) {
      setItems([]);
      return;
    }
    setItems(
      prItemsRef.current
        .filter((pi) => !pi.preferredSupplierId || pi.preferredSupplierId === newId)
        .map((pi) => prItemToLine(pi)),
    );
  }

  // Auto-load items from SO when arriving with initialSoId (direct mode)
  useEffect(() => {
    if (isPrMode || !initialSoId || !selectedSo) return;
    setLoadingSoItems(true);
    getSalesOrderItemsForPo(initialSoId).then(({ items: soItems, orderedSupplierIds: oids, orderedProductCodes: opcodes }) => {
      setOrderedSupplierIds(oids);
      setOrderedProductCodes(opcodes);
      if (soItems.length > 0) {
        const detected = detectCurrency(soItems);
        setCurrency(detected);
        setItems(soItems.map((si) => ({
          _key: uid(),
          rowNo: si.rowNo,
          productId: si.productId ?? undefined,
          productCode: si.productCode ?? "",
          description: si.description ?? "",
          qty: si.qty,
          uom: si.uom ?? "",
          unitPrice: si.unitPrice ?? "0",
          currency: detected,
          totalPrice: si.totalPrice ?? "0",
          imageKey: si.imageKey ?? undefined,
        })));
      }
    }).catch(() => toast.error("Failed to load SO items")).finally(() => setLoadingSoItems(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Supplier quotation PDF
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfKey, setPdfKey] = useState<string | undefined>();
  const [pdfUploading, setPdfUploading] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);

  const committedRef = useRef(false);
  const itemsRef     = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useCleanupOrphanedImages(itemsRef, committedRef);

  // On mount, fill descriptions from product DB for items that have a productCode but no description
  useEffect(() => {
    const needsLookup = items.filter((i) => i.productCode && !i.description);
    if (!needsLookup.length) return;
    const codes = [...new Set(needsLookup.map((i) => i.productCode!))];
    getProductDetailsByCodes(codes).then((rows) => {
      const descMap = Object.fromEntries(rows.map((r) => [r.productCode, r.description ?? ""]));
      setItems((prev) => prev.map((i) =>
        i.productCode && !i.description && descMap[i.productCode]
          ? { ...i, description: descMap[i.productCode], descriptionSource: "product" }
          : i
      ));
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SO search filter (direct mode)
  const filteredSos = approvedSos.filter((s) => {
    if (!soSearch) return true;
    const q = soSearch.toLowerCase();
    return s.soNo.toLowerCase().includes(q) || s.customerName?.toLowerCase().includes(q);
  });

  // CPO filter (direct mode)
  const selectedCpoIds = new Set(selectedCpos.map((c) => c.id));
  const filteredCpos = customerPos.filter((c) => {
    if (selectedCpoIds.has(c.id)) return false;
    if (!cpoSearch) return true;
    const q = cpoSearch.toLowerCase();
    return c.customerPoNo.toLowerCase().includes(q) || c.customerName?.toLowerCase().includes(q);
  });

  function addCpo(cpo: CustomerPoOption) {
    setSelectedCpos((prev) => [...prev, cpo]);
    setCpoSearch("");
  }

  function removeCpo(id: string) {
    setSelectedCpos((prev) => prev.filter((c) => c.id !== id));
  }

  const updateItem = useUpdateItem(setItems);
  const addLine = useAddLine(setItems);
  const removeLine = useRemoveLine({ itemsRef, setItems });
  const handleProductCodeBlur = useHandleProductCodeBlur({ itemsRef, setItems });
  const { handleItemImage, removeItemImage } = useItemImageHandlers({ itemsRef, updateItem });

  // Best-effort import of a manually-issued supplier PO spreadsheet (.xlsx/.xls/.ods/.csv).
  // Supplier PO layouts vary a lot — this locates the item table by scanning
  // for a row containing both a "No" and a "Description"-like header, then
  // matches columns by alias rather than fixed position. Always review the
  // result before saving; this is not guaranteed to read every format.
  function processPoSpreadsheet(file: File) {
    setImportingSheet(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const cell = (row: unknown[] | undefined, i: number): string =>
          row && row[i] !== undefined && row[i] !== null ? String(row[i]).trim() : "";

        // 1. Find the item-table header row — the first row with both a
        // "No"-like cell and a "Description"-like cell.
        let headerRowIdx = -1;
        for (let i = 0; i < grid.length; i++) {
          const row = grid[i];
          const hasNo = row.some((c) => /^(no\.?|#)$/i.test(String(c).trim()));
          const hasDesc = row.some((c) => /desc/i.test(String(c).trim()));
          if (hasNo && hasDesc) { headerRowIdx = i; break; }
        }
        if (headerRowIdx === -1) {
          toast.error("Couldn't find an item table in this file — the format may not be recognized");
          return;
        }

        const header = grid[headerRowIdx].map((c) => String(c).toLowerCase().replace(/\s+/g, " ").trim());
        const colIdx = (...aliases: string[]): number => {
          for (const a of aliases) {
            const idx = header.indexOf(a);
            if (idx !== -1) return idx;
          }
          return -1;
        };

        const idxProductCode = colIdx("product code", "item code", "code");
        const idxDesignBrandName = colIdx("design brand name to refer", "design brand name", "brand");
        const idxDesignBrandCode = colIdx("design brand code to refer", "design brand code", "design code");
        const idxEmboss = colIdx("best medical code to emboss", "emboss code", "private label code");
        const rawIdxDescription = colIdx("description", "item description");
        const rawIdxQty = colIdx("qty", "quantity");
        const rawIdxUom = colIdx("oum", "uom", "unit");
        const rawIdxUnitPrice = colIdx("price/pc", "price / pc", "unit price");
        const rawIdxTotalPrice = colIdx("total", "amount", "price");

        // Some sheets have a merged header cell (e.g. "Product Code" spanning
        // 3 columns) that the data rows don't mirror — every field after it
        // then reads one column left of where the header puts it, landing a
        // number (qty) where a description should be. Detect this by
        // checking whether the description column looks numeric on the
        // first data row while the column just before it looks like text,
        // and shift the rest of the field indices left to compensate.
        const looksNumeric = (s: string) => /^-?\d+(\.\d+)?$/.test(s.trim());
        const looksLikeText = (s: string) => /[a-zA-Z]{3,}/.test(s);
        const firstDataRow = grid.slice(headerRowIdx + 1).find((r) => cell(r, 0) !== "");
        const misaligned = !!(
          firstDataRow && rawIdxDescription > 0 &&
          looksNumeric(cell(firstDataRow, rawIdxDescription)) &&
          looksLikeText(cell(firstDataRow, rawIdxDescription - 1))
        );
        const shift = misaligned ? 1 : 0;
        const shiftIdx = (i: number) => (i === -1 ? -1 : i - shift);
        const idxDescription = shiftIdx(rawIdxDescription);
        const idxQty = shiftIdx(rawIdxQty);
        const idxUom = shiftIdx(rawIdxUom);
        const idxUnitPrice = shiftIdx(rawIdxUnitPrice);
        const idxTotalPriceShifted = shiftIdx(rawIdxTotalPrice);
        const idxTotalPrice = idxTotalPriceShifted !== idxUnitPrice ? idxTotalPriceShifted : -1;

        // 1b. Group/set title — many supplier sheets carry a single-cell
        // label directly above the item table naming what the whole sheet
        // is ("LOOSE ITEM", "AMPUTATION SET", "MEDIUM SET"). Only the row
        // immediately touching the header counts, so it isn't confused with
        // the ref/date/supplier block further up.
        let groupTitleGuess = "";
        if (headerRowIdx > 0) {
          const titleRow = grid[headerRowIdx - 1];
          const titleCells = titleRow.map((_, j) => cell(titleRow, j)).filter(Boolean);
          if (titleCells.length === 1 && !/^(purchase order|ref\.?|date|quotation ref)/i.test(titleCells[0])) {
            groupTitleGuess = titleCells[0];
          }
        }
        const groupId = groupTitleGuess ? uid() : undefined;

        // 2. Item rows — stop at the first summary/footer line
        const STOP = /subtotal|^total\b|discount|remark|authoris/i;
        const rawItems: LineItem[] = [];
        let currencyGuess = "";
        for (let i = headerRowIdx + 1; i < grid.length; i++) {
          const row = grid[i];
          const firstCell = cell(row, 0);
          if (STOP.test(firstCell)) {
            // Totals/subtotal rows often carry the currency, e.g. "SUBTOTAL (USD)"
            const m = firstCell.match(/\(([A-Za-z]{3})\)/);
            if (m && !currencyGuess) currencyGuess = m[1].toUpperCase();
            break;
          }
          const description = cell(row, idxDescription);
          const embossCode = cell(row, idxEmboss);
          const productCode = cell(row, idxProductCode) || embossCode;
          if (!description && !productCode) continue;

          const qty = cell(row, idxQty) || "1";
          const unitPrice = cell(row, idxUnitPrice) || "0";
          const totalPrice = cell(row, idxTotalPrice) || (parseFloat(qty) * parseFloat(unitPrice)).toFixed(2);
          const designBrandName = cell(row, idxDesignBrandName);
          const designBrandCode = cell(row, idxDesignBrandCode);
          const hasOem = !!(designBrandName || designBrandCode || embossCode);

          const line = newLine(rawItems.length + 1, uid());
          line.productCode = productCode;
          line.description = description.toUpperCase();
          line.qty = qty;
          line.uom = cell(row, idxUom);
          line.unitPrice = unitPrice;
          line.totalPrice = totalPrice;
          if (groupTitleGuess) {
            line.setGroupId = groupId;
            line.setGroupLabel = groupTitleGuess;
          }
          if (hasOem) {
            line.sourcingType = "oem";
            line.designBrandName = designBrandName;
            line.designBrandCode = designBrandCode;
            line.privateLabelCode = embossCode || productCode;
            line.designBrandSource = "user";
            line.privateLabelSource = "user";
            line.oemEditedBy = currentUserName || "user";
          }
          rawItems.push(line);
        }

        if (rawItems.length === 0) {
          toast.error("No item rows found in this file");
          return;
        }

        // 3. Header block, above the item table: PO ref, issue date, supplier name
        let refGuess = "";
        let dateGuess = "";
        let supplierGuess = "";
        for (let i = 0; i < headerRowIdx; i++) {
          const row = grid[i];
          for (let j = 0; j < row.length; j++) {
            const c = cell(row, j);
            if (!refGuess && /^ref/i.test(c)) {
              // Value may be inline after a colon ("Ref: PO/041-26") or in the
              // next cell ("Ref" | "PO/041-26") — never the label's own colon.
              const afterColon = c.includes(":") ? c.split(":").slice(1).join(":").trim() : "";
              refGuess = afterColon || cell(row, j + 1);
            }
            if (!dateGuess && /^date/i.test(c)) {
              const next = row[j + 1];
              if (typeof next === "number") {
                const d = XLSX.SSF.parse_date_code(next);
                if (d) dateGuess = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
              } else {
                dateGuess = cell(row, j + 1);
              }
            }
          }
          const firstCell = cell(row, 0);
          if (
            !supplierGuess && firstCell && firstCell !== groupTitleGuess &&
            !/purchase order|^ref|^date|quotation ref|^no\.?$/i.test(firstCell)
          ) {
            supplierGuess = firstCell;
          }
        }

        if (currencyGuess && CURRENCIES.includes(currencyGuess)) {
          rawItems.forEach((li) => { li.currency = currencyGuess; });
          setCurrency(currencyGuess);
        }
        setItems(rawItems);
        if (refGuess) { setUseManualPoNo(true); setManualPoNo(refGuess); }
        const noteParts = [refGuess && `Original ref: ${refGuess}`, dateGuess && `Originally issued: ${dateGuess}`, `Imported from ${file.name}`].filter(Boolean);
        setNotes((prev) => prev ? prev : noteParts.join(" — "));

        if (supplierGuess) {
          const match = suppliers.find((s) =>
            s.name.toLowerCase().includes(supplierGuess.toLowerCase()) ||
            supplierGuess.toLowerCase().includes(s.name.toLowerCase()),
          );
          if (match) setSupplierId(match.id);
          else toast.error(`Detected supplier "${supplierGuess}" isn't in your supplier list yet — pick or create it manually`);
        }

        // Resolve description/sourcing against the catalog for rows with a
        // code — guarded fields (already filled from the sheet) are left alone.
        rawItems.forEach((li) => { if (li.productCode) handleProductCodeBlur(li._key, li.productCode); });

        toast.success(`Imported ${rawItems.length} item(s) — review everything before saving`);
      } catch (err) {
        console.error(err);
        toast.error("Failed to parse this spreadsheet — the format may not be recognized");
      } finally {
        setImportingSheet(false);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handlePdfSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { toast.error("Only PDF files are allowed"); return; }
    setPdfFile(file);
    setPdfUploading(true);
    try {
      const { key, uploadUrl } = await getPoSupplierQuotationUploadUrl(file.name);
      await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": "application/pdf" } });
      setPdfKey(key);
      toast.success("PDF uploaded");
    } catch {
      toast.error("Failed to upload PDF");
      setPdfFile(null);
    } finally {
      setPdfUploading(false);
    }
  }

  function removePdf() {
    setPdfFile(null);
    setPdfKey(undefined);
    if (pdfRef.current) pdfRef.current.value = "";
  }

  async function buildAndCreate() {
    if (!supplierId) { toast.error("Supplier is required"); return null; }
    if (!items.some((i) => i.description || i.productCode)) { toast.error("Add at least one item"); return null; }
    if (items.some((i) => i._imageUploading)) { toast.error("Please wait for image uploads to finish"); return null; }
    if (useManualPoNo && !manualPoNo.trim()) { toast.error("Enter the existing PO number, or turn that off to auto-generate one"); return null; }
    if (showSourcing) {
      const realItems = items.filter((i) => i.description || i.productCode);
      if (realItems.some((i) => !i.sourcingType)) {
        toast.error("Pick Trading or OEM for every item");
        return null;
      }
      if (realItems.some((i) => i.sourcingType === "oem" && (!i.designBrandName?.trim() || !i.designBrandCode?.trim() || !i.privateLabelCode?.trim()))) {
        toast.error("Fill in Design Brand, Design Code and Emboss Code for every OEM item");
        return null;
      }
    }

    const { subtotal, sstAmt, grand } = calcTotals(items, sstPct);

    // In PR mode: collect unique CPO IDs from item-level cpoId fields
    const prModeCpoIds = isPrMode
      ? [...new Set(items.map((i) => i._cpoId).filter(Boolean) as string[])]
      : [];

    return createPurchaseOrder({
      purchaseRequisitionId: prData?.id,
      supplierId,
      salesOrderId: isPrMode ? (prData?.salesOrderId ?? undefined) : selectedSo?.id,
      customerPoIds: isPrMode ? prModeCpoIds : selectedCpos.map((c) => c.id),
      supplierQuotationKey: pdfKey,
      currency,
      subtotal: subtotal.toFixed(2),
      sstPct,
      sst: sstAmt.toFixed(2),
      grandTotal: grand.toFixed(2),
      notes: notes || undefined,
      expectedDeliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
      deliveryAddress: deliveryAddress || undefined,
      manualPoNo: !isPrMode && useManualPoNo ? manualPoNo.trim() : undefined,
      items: items.map(({ _key, _imageFile, _imageUploading, _imagePreviewUrl, _imageInherited, _cpoId, _codeEditing, ...rest }) => rest),
    });
  }

  async function handleCreatePo() {
    setSaving(true);
    try {
      const po = await buildAndCreate();
      if (!po) return;
      committedRef.current = true;
      toast.success(`Purchase order ${po.poNo ?? ""} created`);
      router.push(`/dashboard/procurement/purchase-order/${po.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const { subtotal, sstAmt, grand } = calcTotals(items, sstPct);

  const backHref = backHrefProp
    ?? (isPrMode
      ? `/dashboard/procurement/requisition/${prData!.id}`
      : "/dashboard/procurement/purchase-order");

  return (
    <div className="p-6">
      <PageHeader
        title="Create Purchase Order"
        description={
          isPrMode
            ? `Converting ${prData!.prNo} to a supplier purchase order`
            : "Issue a purchase order directly to a supplier"
        }
        action={
          <Button variant="outline" size="sm" onClick={() => router.push(backHref)} className="gap-2">
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
          </Button>
        }
      />

      <div className="space-y-6">
        {/* ── PR source banner (PR mode only) ── */}
        {isPrMode && (
          <section className="border border-blue-200 dark:border-blue-800 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-800 dark:text-blue-300 uppercase tracking-wide">
              <ClipboardListIcon className="w-3.5 h-3.5" /> Source Requisition
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-medium text-sm">{prData!.prNo}</span>
              {prData!.salesOrderNo && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <LinkIcon className="w-3 h-3" /> {prData!.salesOrderNo}
                </span>
              )}
              {prData!.cpoNos.map((cpo) => (
                <span key={cpo} className="inline-flex items-center text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md border bg-blue-100 dark:bg-blue-800/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700">
                  {cpo}
                </span>
              ))}
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-400">
              Select a supplier below — items will be filtered to show only those assigned to that supplier.
            </p>
          </section>
        )}

        {/* ── Import from spreadsheet (direct mode only) ── */}
        {!isPrMode && (
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-1">Import from spreadsheet</h2>
            <p className="text-xs text-muted-foreground mb-3">
              For backfilling a PO that was already issued manually — reads a supplier PO spreadsheet
              (.xlsx, .xls, .ods, .csv) and fills in the fields below. Best-effort: supplier PO layouts
              vary, so always review everything before saving.
            </p>
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
              <UploadIcon className="w-4 h-4" />
              <span>{importingSheet ? "Reading file…" : "Choose spreadsheet…"}</span>
              <input
                type="file"
                accept=".xlsx,.xls,.ods,.csv"
                className="hidden"
                disabled={importingSheet}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) processPoSpreadsheet(f); e.target.value = ""; }}
              />
            </label>
          </section>
        )}

        {/* ── Supplier (required) ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-1">
            Supplier <span className="text-destructive">*</span>
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Select the supplier you are issuing this PO to
          </p>
          {suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No suppliers found.{" "}
              <button className="underline" onClick={() => router.push("/dashboard/procurement/supplier")}>
                Add one first.
              </button>
            </p>
          ) : (
            <select
              className={`w-full h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${!supplierId ? "border-destructive/50" : "border-border"}`}
              value={supplierId}
              onChange={(e) => handleSupplierChange(e.target.value)}
            >
              <option value="">— Select supplier —</option>
              {isPrMode && (() => {
                const preferred = [...new Map(
                  prData!.items
                    .filter((i) => i.preferredSupplierId)
                    .map((i) => [i.preferredSupplierId, i.preferredSupplierName])
                ).entries()];
                if (preferred.length === 0) return null;
                return (
                  <optgroup label="Preferred suppliers (from PR)">
                    {preferred.map(([id, name]) => (
                      <option key={id} value={id!}>{name}</option>
                    ))}
                  </optgroup>
                );
              })()}
              {!isPrMode && orderedSupplierIds.length > 0 && (
                <optgroup label="Already have PO for this SO">
                  {suppliers.filter((s) => orderedSupplierIds.includes(s.id)).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.registrationNo ? ` (${s.registrationNo})` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={isPrMode ? "All suppliers" : (orderedSupplierIds.length > 0 ? "Other suppliers" : "Suppliers")}>
                {suppliers.filter((s) => isPrMode || !orderedSupplierIds.includes(s.id)).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.registrationNo ? ` (${s.registrationNo})` : ""}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
          {!isPrMode && supplierId && orderedSupplierIds.includes(supplierId) && (
            <div className="mt-2 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              <AlertCircleIcon className="w-3.5 h-3.5 shrink-0" />
              This supplier already has an active PO for the selected sales order.
            </div>
          )}
        </section>

        {/* ── Linked SO (direct mode only) ── */}
        {!isPrMode && (
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-1">Linked Sales Order</h2>
            <p className="text-xs text-muted-foreground mb-3">Optional — link to a confirmed SO if this order is tied to a customer order.</p>
            {selectedSo ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2">
                  <div className="flex-1">
                    <span className="text-sm font-mono font-medium">{selectedSo.soNo}</span>
                    {selectedSo.customerName && (
                      <span className="text-xs text-muted-foreground ml-2">— {selectedSo.customerName}</span>
                    )}
                  </div>
                  <button onClick={() => { setSelectedSo(null); setItems([newLine(1)]); setOrderedSupplierIds([]); setOrderedProductCodes([]); }} className="text-muted-foreground hover:text-foreground shrink-0">
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
                {orderedProductCodes.length > 0 && (
                  <div className="flex items-start gap-2 text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
                    <InfoIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      {orderedProductCodes.length} item{orderedProductCodes.length !== 1 ? "s" : ""} already covered by existing POs
                      ({orderedProductCodes.join(", ")}) — showing remaining items only.
                    </span>
                  </div>
                )}
              </div>
            ) : approvedSos.length === 0 ? (
              <p className="text-xs text-muted-foreground">No approved sales orders available</p>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    value={soSearch}
                    onChange={(e) => setSoSearch(e.target.value)}
                    placeholder="Search by SO no. or customer..."
                    className="pl-9 h-8 text-sm"
                  />
                </div>
                {(soSearch ? filteredSos : approvedSos).slice(0, 6).map((so) => (
                  <button
                    key={so.id}
                    className="w-full text-left px-3 py-2 rounded-lg border border-border hover:bg-muted/40 transition-colors text-sm"
                    onClick={async () => {
                      setSelectedSo(so);
                      setSoSearch("");
                      setLoadingSoItems(true);
                      try {
                        const { items: soItems, orderedSupplierIds: oids, orderedProductCodes: opcodes } = await getSalesOrderItemsForPo(so.id);
                        setOrderedSupplierIds(oids);
                        setOrderedProductCodes(opcodes);
                        if (soItems.length > 0) {
                          const detected = detectCurrency(soItems);
                          setCurrency(detected);
                          setItems(soItems.map((si) => ({
                            _key: uid(),
                            rowNo: si.rowNo,
                            productId: si.productId ?? undefined,
                            productCode: si.productCode ?? "",
                            description: si.description ?? "",
                            qty: si.qty,
                            uom: si.uom ?? "",
                            unitPrice: si.unitPrice ?? "0",
                            currency: detected,
                            totalPrice: si.totalPrice ?? "0",
                            imageKey: si.imageKey ?? undefined,
                          })));
                        } else {
                          setItems([newLine(1)]);
                        }
                      } catch {
                        toast.error("Failed to load SO items");
                      } finally {
                        setLoadingSoItems(false);
                      }
                    }}
                  >
                    <span className="font-mono font-medium">
                      <Highlight text={so.soNo} query={soSearch} />
                    </span>
                    {so.customerName && (
                      <span className="text-xs text-muted-foreground ml-2">
                        — <Highlight text={so.customerName} query={soSearch} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Linked Customer POs (direct mode only) ── */}
        {!isPrMode && (
          <section className="border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-1">Customer Purchase Orders</h2>
            <p className="text-xs text-muted-foreground mb-3">Link customer POs that this purchase order fulfills (optional)</p>
            {selectedCpos.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {selectedCpos.map((cpo) => (
                  <div key={cpo.id} className="flex items-center gap-1.5 bg-muted/40 border border-border rounded-md px-2.5 py-1 text-xs">
                    <span className="font-mono font-medium">{cpo.customerPoNo}</span>
                    {cpo.customerName && <span className="text-muted-foreground">· {cpo.customerName}</span>}
                    <button onClick={() => removeCpo(cpo.id)} className="text-muted-foreground hover:text-foreground ml-0.5">
                      <XIcon className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {customerPos.length === 0 ? (
              <p className="text-xs text-muted-foreground">No active customer POs available</p>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    value={cpoSearch}
                    onChange={(e) => setCpoSearch(e.target.value)}
                    placeholder="Search by customer PO no. or customer..."
                    className="pl-9 h-8 text-sm"
                  />
                </div>
                {filteredCpos.slice(0, 6).map((cpo) => (
                  <button
                    key={cpo.id}
                    className="w-full text-left px-3 py-2 rounded-lg border border-border hover:bg-muted/40 transition-colors text-sm"
                    onClick={() => addCpo(cpo)}
                  >
                    <span className="font-mono font-medium">
                      <Highlight text={cpo.customerPoNo} query={cpoSearch} />
                    </span>
                    {cpo.customerName && (
                      <span className="text-xs text-muted-foreground ml-2">
                        — <Highlight text={cpo.customerName} query={cpoSearch} />
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground ml-2">MYR {parseFloat(cpo.amount).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Order details ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Order details</h2>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Currency</Label>
              <select
                value={currency}
                onChange={(e) => handleCurrencyChange(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          {!isPrMode && (
            <div className="mb-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={useManualPoNo}
                  onChange={(e) => setUseManualPoNo(e.target.checked)}
                  className="rounded border-input"
                />
                This PO was already issued to the supplier — enter its existing number
              </label>
              {useManualPoNo && (
                <Input
                  value={manualPoNo}
                  onChange={(e) => setManualPoNo(e.target.value)}
                  placeholder="e.g. SUP-PO-2026-0042"
                  className="h-9 text-sm mt-1.5 max-w-xs"
                />
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Expected delivery date</Label>
                {deliveryDateInherited && (
                  deliveryDate === deliveryDateInherited
                    ? <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800"><LinkIcon className="w-3 h-3 shrink-0" />from SO</span>
                    : <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"><PencilIcon className="w-3 h-3 shrink-0" />{currentUserName ? `${currentUserName} edited SPO` : "edited SPO"}</span>
                )}
              </div>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Delivery address</Label>
                {deliveryAddressInherited && (
                  deliveryAddress === deliveryAddressInherited
                    ? <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800"><LinkIcon className="w-3 h-3 shrink-0" />from SO</span>
                    : <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"><PencilIcon className="w-3 h-3 shrink-0" />{currentUserName ? `${currentUserName} edited SPO` : "edited SPO"}</span>
                )}
              </div>
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
              placeholder="Delivery instructions or notes to supplier…"
              rows={2}
              className="text-sm"
            />
          </div>
        </section>

        {/* ── Supplier quotation PDF ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Supplier quotation PDF (optional)</h2>
          {pdfFile ? (
            <div className="flex items-center gap-2 text-sm">
              <PaperclipIcon className="w-4 h-4 text-muted-foreground" />
              <span className="flex-1 truncate text-[13px]">{pdfFile.name}</span>
              {pdfUploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
              {!pdfUploading && pdfKey && <span className="text-xs text-green-600">Uploaded</span>}
              <button onClick={removePdf} className="text-muted-foreground hover:text-foreground">
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
              <PaperclipIcon className="w-4 h-4" />
              <span>Attach supplier quotation PDF</span>
              <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={handlePdfSelect} />
            </label>
          )}
        </section>

        {/* ── Items table ── */}
        <PoItemsTable
          items={items}
          showSourcing={showSourcing}
          currency={currency}
          currentUserName={currentUserName}
          loadingSoItems={loadingSoItems}
          isPrMode={isPrMode}
          supplierId={supplierId}
          updateItem={updateItem}
          addLine={addLine}
          removeLine={removeLine}
          handleProductCodeBlur={handleProductCodeBlur}
          handleItemImage={handleItemImage}
          removeItemImage={removeItemImage}
        />

        {/* ── Pricing summary ── */}
        <section className="border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">Pricing</h2>
          <div className="flex justify-end">
            <div className="w-64 space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums font-mono">{fmt(subtotal, currency)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground shrink-0">SST</span>
                <div className="flex items-center gap-1">
                  <Input value={sstPct} onChange={(e) => setSstPct(e.target.value)} className="h-7 w-16 text-xs text-right" />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
                <span className="tabular-nums font-mono text-muted-foreground">{fmt(sstAmt, currency)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t border-border pt-2">
                <span>Grand total</span>
                <span className="tabular-nums font-mono">{fmt(grand, currency)}</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Actions ── */}
        <div className="flex gap-3 pb-8">
          <Button onClick={handleCreatePo} disabled={saving || pdfUploading || loadingSoItems} className="gap-2">
            {saving ? "Creating…" : "Create Purchase Order"}
          </Button>
          <Button variant="outline" onClick={() => router.push(backHref)}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
