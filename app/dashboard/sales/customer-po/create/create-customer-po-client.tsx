"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createCustomerPo, getNextCashSaleNo, getNextPoTbcNo, checkCustomerPoNo, type CpoItemInput } from "@/server/customer-purchase-order";
import { type OrgMember } from "@/server/members";
import { getCustomer } from "@/server/customer";
import { searchQuotationsByNo, getQuotationForSO } from "@/server/quotation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { PageHeader } from "@/components/page-header";
import { getProductByCode } from "@/server/products";
import { cn } from "@/lib/utils";
import { sumLines, setTotal, bookSetPrices } from "@/lib/customer-po/set-price";
import { isSetPriced } from "@/lib/quotation-set-price";
import { uid } from "@/lib/uid";
import { canMove, cpoDescriptionMessage, displayOrder, itemsMissingCpoDescription, titleBySet, isNotAsSetLabel, itemNumbers, moveItem, sinkUnselected, isSettled, NOT_AS_SET_ID, quotationIdOfGroup } from "@/lib/customer-po/item-order";
import { sortBySheetOrder } from "@/lib/customer-po/item-order";
import { customerRelation, otherContactsNote } from "@/lib/customer-po/customer-match";
import { descriptionState, unresolvedDifferences, unresolvedMessage, keepDescription, takeDatabaseText, restorePreviousDescription, canRestorePrevious, ACCEPTED_NOTE, type DescriptionState } from "@/lib/customer-po/description-check";
import { PoMatchResults, type PoReadResult } from "./po-match-panel";
import { PoLinesReview } from "./po-lines-review";
import type { PoLinesResult } from "@/lib/customer-po/po-lines";
import type { Suggestion } from "@/lib/customer-po/quotation-match";
import { useDbDescriptionLookup } from "@/lib/sales-order/use-db-descriptions";
import { applyCpoDescriptions, downloadItemsSheet, readItemsSheet } from "@/lib/customer-po/items-sheet";
import {
  ArrowLeftIcon, SearchIcon, XIcon, PaperclipIcon,
  BuildingIcon, UserIcon, FileTextIcon, PlusIcon,
  PencilIcon, DatabaseIcon, LinkIcon,
  ChevronUpIcon, ChevronDownIcon, DownloadIcon, UploadIcon, AlertTriangleIcon,
} from "lucide-react";

type LinkedQuotation = {
  id: string;
  quotationNo: string;
  grandTotal: string;
  customerId?: string | null;
  customerName?: string | null;
  customerOrg?: string | null;
  customerOrgNames?: string[]; // every organization the customer belongs to (to tell whether two customers share one)
  customerOrgIds?: string[];
  customerOrgMemberId?: string | null;
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
  _origCode?: string; // the code before it was edited (display only)
  _origDescription?: string; // the description before the code was edited, to put back if the code is restored
  _origDescSource?: Array<"quote" | "catalog" | "user"> | null;
  _codeNotFound?: boolean; // the edited code is not in the product database
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
  return sumLines(items);
}

export function CreateCustomerPoClient({ members, currentUserName = "" }: { members: OrgMember[]; currentUserName?: string }) {
  const router = useRouter();

  // ── Quotations (multiple) ──────────────────────────────────────────────────
  const [linkedQuotations, setLinkedQuotations] = useState<LinkedQuotation[]>([]);
  const [showAddSearch,    setShowAddSearch]    = useState(false);
  const [qtSearch,         setQtSearch]         = useState("");
  const [qtResults,        setQtResults]        = useState<Awaited<ReturnType<typeof searchQuotationsByNo>>>([]);
  const [qtHighlight,      setQtHighlight]      = useState(-1);
  const [qtLoading,        setQtLoading]        = useState(false);
  const qtTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const spInputRef = useRef<HTMLInputElement>(null);

  // ── Items ──────────────────────────────────────────────────────────────────
  const [items, setItems] = useState<EditableItem[]>([]);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // ── PO details ─────────────────────────────────────────────────────────────
  const [customerPoNo,   setCustomerPoNo]   = useState("");
  const [amount,         setAmount]         = useState("0");
  const [amountOverride, setAmountOverride] = useState(false);
  const [currency,       setCurrency]       = useState("MYR");
  const [receivedDate,   setReceivedDate]   = useState(new Date().toISOString().split("T")[0]);
  const [deliveryDate,    setDeliveryDate]    = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [salesPersons, setSalesPersons] = useState<{ id: string; name: string; isExt: boolean }[]>([]);
  const [spInput,      setSpInput]      = useState("");
  const [status,         setStatus]         = useState("received");
  const [notes,          setNotes]          = useState("");

  const [cashSaleLoading, setCashSaleLoading] = useState(false);
  const [poTbcLoading, setPoTbcLoading] = useState(false);
  // the number must be unique: told as soon as the field is left, and again before saving
  const [noTaken, setNoTaken] = useState<{ message: string; existingId?: string } | null>(null);
  async function checkNo(no: string): Promise<boolean> {
    if (!no.trim()) { setNoTaken(null); return true; }
    try {
      const r = await checkCustomerPoNo(no.trim(), undefined);
      setNoTaken(r.available ? null : { message: r.message ?? "This customer PO number is already used.", existingId: r.existingId });
      return r.available;
    } catch { return true; } // the server checks again when saving
  }

  // ── PDF ────────────────────────────────────────────────────────────────────
  const [pdfFile,      setPdfFile]      = useState<File | null>(null);
  const [pdfKey,       setPdfKey]       = useState<string | undefined>();
  const [pdfUploading, setPdfUploading] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);
  // What reading the customer's PO document found (the matching quotation, the PO number and date)
  const [poRead, setPoRead] = useState<PoReadResult>({ status: "idle" });
  const [dragging, setDragging] = useState(false);

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
      try {
        setQtResults(await searchQuotationsByNo(val, true));
        setQtHighlight(-1);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Failed to search quotations");
        setQtResults([]);
      }
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
      let customerOrgNames: string[] = [];
      let customerOrgIds: string[] = [];
      let customerOrgMemberId: string | null = null;

      const applySnapshotFallback = () => {
        const snap = qt.customerSnapshot as any;
        customerName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;
        customerOrg  = snap?.organizationName ?? null;
        customerOrgNames = snap?.organizationName ? [snap.organizationName] : [];
      };

      if (qt.customerId) {
        try {
          const cust = await getCustomer(qt.customerId);
          if (cust) {
            customerName = [cust.title, cust.name].filter(Boolean).join(" ");
            const primary = cust.memberships.find((c) => c.isPrimary) ?? cust.memberships[0];
            customerOrg  = primary?.orgName ?? null;
            customerOrgNames = cust.memberships.map((m) => m.orgName).filter((n): n is string => !!n);
            customerOrgIds = cust.memberships.map((m) => m.customerOrganizationId).filter((n): n is string => !!n);
            customerOrgMemberId = primary?.id ?? null;
          } else {
            applySnapshotFallback();
          }
        } catch {
          applySnapshotFallback();
        }
      } else {
        applySnapshotFallback();
      }

      // The same customer, or another contact of the same customer organization (allowed, with a gentle warning at
      // the customer field). A customer of a different organization cannot share a Customer PO.
      if (primaryCustomer) {
        const rel = customerRelation(
          { customerId: primaryCustomer.customerId, orgNames: primaryCustomer.customerOrgNames ?? [primaryCustomer.customerOrg], orgIds: primaryCustomer.customerOrgIds },
          { customerId: qt.customerId, orgNames: customerOrgNames, orgIds: customerOrgIds },
        );
        if (rel === "different") {
          toast.error(`Cannot link — this quotation is for a customer of a different organization${customerOrg ? ` (${customerOrg})` : ""}. Quotations can be combined for the same customer, or for other contacts of the same organization.`, { duration: 9000 });
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
        customerOrgNames,
        customerOrgIds,
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
          if (addrLines && !addressFromDoc.current) setDeliveryAddress(addrLines);
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
        const resolvedGroupLabel = itemHasGroup ? (item.setGroupLabel ?? "") : autoGroupLabel;
        // "not-as-set" lines from every quotation form ONE group, so they can be ordered together
        const notAsSet           = itemHasGroup && isNotAsSetLabel(resolvedGroupLabel);
        const resolvedGroupId    = notAsSet ? NOT_AS_SET_ID : itemHasGroup ? `${qt.id}:${item.setGroupId}` : autoGroupId;
        // The quotation can be for several sets (e.g. 6): everything on it is multiplied by that. It goes on the number of
        // sets of each set, or on the quantity of a loose item, so the CPO carries the full quantity and amount.
        const quotedSets         = Math.max(1, Number(qt.sets ?? 1) || 1);
        const looseLine          = notAsSet || (!itemHasGroup && !autoGroup);
        const resolvedSetQty     = notAsSet ? "1" : itemHasGroup ? String((Number(item.setQty ?? 1) || 1) * quotedSets) : (autoGroup ? String(quotedSets) : "");
        const base: EditableItem = {
          _key:          uid(),
          _quotationId:  qt.id,
          _quotationNo:  qt.quotationNo,
          // the customer of the quotation this line came from, kept on the line (it is used on the sales order, PR and supplier PO)
          customerId:             qt.customerId ?? undefined,
          customerName:           customerName ?? undefined,
          customerOrganization:   customerOrg ?? undefined,
          customerOrganizationId: customerOrgMemberId ?? undefined,
          included:      true,
          rowNo:         startRow + idx + 1,
          productCode:   item.productCode  ?? "",
          description:   item.description  ?? "",
          qty:           looseLine && quotedSets > 1 ? String((Number(item.qty ?? 1) || 1) * quotedSets) : String(item.qty ?? "1"),
          uom:           item.uom          ?? "",
          unitPrice:     String(item.unitPrice  ?? "0"),
          discountPct:   String(item.discountPct ?? "0"),
          totalPrice:    String(item.totalPrice  ?? "0"),
          lineType:      item.lineType ?? "sell",
          setGroupId:    resolvedGroupId,
          setGroupLabel: resolvedGroupLabel,
          setQty:        resolvedSetQty,
          // a set priced as a whole on the quotation keeps that lump sum (its lines have no unit price)
          setPrice:      itemHasGroup && !notAsSet && Number(item.setPrice) > 0 ? String(item.setPrice) : undefined,
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
    setLinkedQuotations((prev) => prev.filter((q) => q.id !== qtId));
    setItems((prev) => {
      const next = prev.filter((i) => i._quotationId !== qtId);
      if (!amountOverride) setAmount(sumItems(next));
      return next;
    });
    if (linkedQuotations.length <= 1) setShowAddSearch(false);
  }

  // ── Item editing ──────────────────────────────────────────────────────────

  // Changing the code reloads the description (and UOM) from the product database. If the code is not in
  // the database the description is left as it was and the row says so. Typing the original code back
  // restores the original description as well.
  const lookupTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => () => { Object.values(lookupTimers.current).forEach(clearTimeout); }, []);

  function scheduleDescriptionLookup(key: string, code: string) {
    clearTimeout(lookupTimers.current[key]);
    const c = code.trim();
    if (!c) return;
    lookupTimers.current[key] = setTimeout(async () => {
      let product: Awaited<ReturnType<typeof getProductByCode>> | undefined;
      try { product = await getProductByCode(c); } catch { product = undefined; } // no permission to read products: leave it alone
      if (product === undefined) return;
      setItems((prev) => prev.map((i) => {
        if (i._key !== key || (i.productCode ?? "").trim().toLowerCase() !== c.toLowerCase()) return i; // the code changed again meanwhile
        if (!product) return { ...i, _codeNotFound: true };
        return {
          ...i,
          description: product.description?.trim() ? product.description.trim() : i.description,
          uom: product.uom ?? i.uom,
          descAccepted: product.description?.trim() ? false : i.descAccepted,
          descAcceptedBy: product.description?.trim() ? undefined : i.descAcceptedBy,
          prevDescription: product.description?.trim() ? undefined : i.prevDescription,
          _descriptionSource: product.description?.trim() ? ["catalog"] : i._descriptionSource,
          _codeNotFound: false,
        };
      }));
    }, 450);
  }

  function handleCodeChange(key: string, v: string) {
    setItems((prev) => prev.map((i) => {
      if (i._key !== key) return i;
      const origCode = i._origCode ?? (i._codeSource === "user" ? undefined : i.productCode);
      if (origCode !== undefined && v.trim() === origCode.trim()) {
        return {
          ...i, productCode: v, _codeSource: "quote", _origCode: undefined, _codeNotFound: false,
          description: i._origDescription ?? i.description,
          _descriptionSource: i._origDescription !== undefined ? i._origDescSource : i._descriptionSource,
          _origDescription: undefined, _origDescSource: undefined,
        } as EditableItem;
      }
      const first = i._origDescription === undefined && origCode !== undefined;
      return {
        ...i, productCode: v, _codeSource: "user", _editedBy: currentUserName || null, _origCode: origCode,
        _origDescription: first ? i.description : i._origDescription,
        _origDescSource: first ? i._descriptionSource : i._origDescSource,
        _codeNotFound: v.trim() ? i._codeNotFound : false,
      } as EditableItem;
    }));
    scheduleDescriptionLookup(key, v);
  }

  // Editable cells in tab order: code, qty, uom, unit price (the description is read-only text)
  const EDITABLE_COLS = [0, 2, 3, 4];

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
    const at = EDITABLE_COLS.indexOf(colIdx);
    const last = EDITABLE_COLS[EDITABLE_COLS.length - 1];
    const next = () => {
      if (at < EDITABLE_COLS.length - 1) focus(rowIdx, EDITABLE_COLS[at + 1]);
      else if (rowIdx < items.length - 1) focus(rowIdx + 1, EDITABLE_COLS[0]);
    };
    const prev = () => {
      if (at > 0) focus(rowIdx, EDITABLE_COLS[at - 1]);
      else if (rowIdx > 0) focus(rowIdx - 1, last);
    };
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      next();
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      prev();
    } else if (mod && e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (mod && e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
    } else if (mod && e.key === "ArrowDown") {
      e.preventDefault();
      focus(rowIdx + 1, colIdx);
    } else if (mod && e.key === "ArrowUp") {
      e.preventDefault();
      if (rowIdx > 0) focus(rowIdx - 1, colIdx);
    }
  }

  // CPO description spreadsheet: download the items, fill the column, upload it again
  const sheetRef = useRef<HTMLInputElement>(null);
  async function handleDownloadSheet() {
    try {
      const numbers = itemNumbers(items);
      const titles = titleBySet(items); // the same set title on every row of the set
      const rows = displayOrder(items)
        .filter((i) => i.included)
        .map((i) => {
          const gid = i.setGroupId && !isNotAsSetLabel(i.setGroupLabel) ? i.setGroupId : "";
          return {
            key: i._key,
            no: numbers.get(i._key)!,
            productCode: i.productCode || "",
            description: i.description || "",
            qty: i.qty,
            uom: i.uom || "",
            setGroupLabel: i.setGroupLabel || "",
            setGroupId: gid,
            setCpoTitle: gid ? (titles.get(gid) ?? "") : "",
            cpoDescription: i.cpoDescription ?? "",
          };
        });
      await downloadItemsSheet(rows, `CPO-items-${(customerPoNo || "new").replace(/[^\w.-]+/g, "_")}.xlsx`);
    } catch (e: any) {
      toast.error(e.message || "Could not create the sheet");
    }
  }
  async function handleUploadSheet(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const numbers = itemNumbers(items);
      const target = items
        .filter((i) => i.included)
        .map((i) => ({ key: i._key, no: numbers.get(i._key)!, productCode: i.productCode || "", qty: i.qty, setGroupLabel: i.setGroupLabel || "", setGroupId: i.setGroupId && !isNotAsSetLabel(i.setGroupLabel) ? i.setGroupId : "" }));
      const { updates, setTitles, setLabels, qtys, filled, skipped, conflicts, order } = applyCpoDescriptions(target, await readItemsSheet(file));
      // the rows are in the order of the customer's PO: the items follow it (items already on the CPO only)
      const nowOrder = displayOrder(items).map((x) => x._key).filter((k) => order.includes(k));
      const reordered = order.some((k, i) => k !== nowOrder[i]);
      const changed = filled + setTitles.size + setLabels.size + qtys.size + (reordered ? 1 : 0);
      if (changed > 0)
        setItems((prev) => {
          // Sets that exist (or are being created by this upload), found by name regardless of case
          const groups = new Map<string, { id: string; label: string; setQty: string }>();
          for (const i of prev) if (i.setGroupId && i.setGroupLabel) groups.set(i.setGroupLabel.trim().toLowerCase(), { id: i.setGroupId, label: i.setGroupLabel, setQty: i.setQty || "1" });
          let next = prev.map((i) => {
            let it: EditableItem = { ...i, ...(updates.has(i._key) ? { cpoDescription: updates.get(i._key) } : {}) };
            const lbl = setLabels.get(i._key);
            if (lbl !== undefined) {
              const notSet = isNotAsSetLabel(lbl);
              const key = lbl.trim().toLowerCase();
              const g = groups.get(key) ?? { id: notSet ? NOT_AS_SET_ID : `g-${lbl.trim()}`, label: notSet ? "not-as-set" : lbl.trim(), setQty: "1" };
              groups.set(key, g);
              it = calcItemTotal({ ...it, setGroupLabel: g.label, setGroupId: g.id, setQty: notSet ? "1" : g.setQty });
            }
            // A quantity typed in the sheet goes into the qty field (and the line total follows)
            if (qtys.has(i._key)) it = calcItemTotal({ ...it, qty: qtys.get(i._key)!, _qtySource: "user", _editedBy: currentUserName || null });
            return it;
          });
          // A set title belongs to the set the item ended up in
          for (const [key, title] of setTitles) {
            const gid = next.find((i) => i._key === key)?.setGroupId;
            if (gid) next = next.map((i) => (i.setGroupId === gid && !isNotAsSetLabel(i.setGroupLabel) ? { ...i, setCpoTitle: title } : i));
          }
          if ((qtys.size > 0 || setLabels.size > 0) && !amountOverride) setAmount(sumItems(next));
          return sortBySheetOrder(next, order);
        });
      const parts = [
        ...(filled ? [`${filled} CPO description${filled === 1 ? "" : "s"}`] : []),
        ...(setLabels.size ? [`${setLabels.size} set assignment${setLabels.size === 1 ? "" : "s"}`] : []),
        ...(setTitles.size ? [`${setTitles.size} set title${setTitles.size === 1 ? "" : "s"}`] : []),
        ...(qtys.size ? [`${qtys.size} quantit${qtys.size === 1 ? "y" : "ies"}`] : []),
        ...(reordered ? ["the item order"] : []),
      ];
      if (changed === 0 && skipped.length === 0 && conflicts.length === 0) toast.info("Nothing new found in the sheet");
      else toast.success(`Updated ${parts.join(", ") || "nothing"}${skipped.length ? ` · ${skipped.length} row${skipped.length === 1 ? "" : "s"} skipped` : ""}`);
      if (conflicts.length) toast.error(conflicts.slice(0, 3).join("\n") + (conflicts.length > 3 ? `\n…and ${conflicts.length - 3} more` : ""), { duration: 15000 });
      if (skipped.length) toast.warning(skipped.slice(0, 4).join("\n") + (skipped.length > 4 ? `\n…and ${skipped.length - 4} more` : ""), { duration: 12000 });
    } catch (err: any) {
      toast.error(err.message || "Could not read the sheet");
    }
  }

  // The description in the product database for each code on the page (the code is the reference): a description
  // taken from the quotation that differs from it has to be confirmed or replaced
  const dbDescMap = useDbDescriptionLookup(items.map((i) => i.productCode ?? ""));

  function acceptDescription(key: string) {
    setItems((prev) => prev.map((i) => (i._key === key ? keepDescription(i, currentUserName) : i)));
    toast.warning(ACCEPTED_NOTE, { duration: 9000 });
  }
  function useDatabaseDescription(key: string) {
    setItems((prev) => prev.map((i) => (i._key === key ? takeDatabaseText(i, descriptionState(i, dbDescMap).dbText) : i)));
  }
  // Going back to the description that was replaced with the database one
  function restoreDescription(key: string) {
    setItems((prev) => prev.map((i) => (i._key === key ? restorePreviousDescription(i, currentUserName) : i)));
    toast.warning(ACCEPTED_NOTE, { duration: 9000 });
  }

  // Ticked items stay together in order and the unticked ones sit below the last ticked one (inside each set).
  // This runs after every change, so a tick, a spreadsheet upload or a load all end up in the same tidy order.
  useEffect(() => {
    setItems((prev) => (isSettled(prev) ? prev : sinkUnselected(prev)));
  }, [items]);

  // The row that was just ticked or moved is highlighted for a moment and scrolled into view, so it is easy to follow
  const [flashKey, setFlashKey] = useState<string | null>(null);
  useEffect(() => {
    if (!flashKey) return;
    const t = setTimeout(() => document.querySelector(`[data-item-row="${flashKey}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
    const clear = setTimeout(() => setFlashKey(null), 1600);
    return () => { clearTimeout(t); clearTimeout(clear); };
  }, [flashKey]);

  // Move an item up/down among the ticked items of its own block (same quotation and set). Numbers (#) follow the new order.
  function handleMove(key: string, dir: -1 | 1) {
    setItems((prev) => moveItem(prev, key, dir));
    setFlashKey(key);
  }

  function updateItem(key: string, patch: Partial<EditableItem>) {
    if ("included" in patch) setFlashKey(key);
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
          ? calcItemTotal({ ...x, setGroupLabel: newLabel, setGroupId: gid, setQty: existing?.setQty || x.setQty || "1", setCpoTitle: existing?.setCpoTitle ?? x.setCpoTitle, setPrice: existing?.setPrice })
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

  // The set's main title as written on the customer's PO (same on every item of the set)
  function handleSetTitleChange(groupId: string, title: string) {
    setItems((prev) => prev.map((x) => (x.setGroupId === groupId ? { ...x, setCpoTitle: title } : x)));
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
          ? calcItemTotal({ ...x, setGroupId: "", setGroupLabel: "", setQty: "", setCpoTitle: "", setPrice: undefined })
          : x,
      );
      if (!amountOverride) setAmount(sumItems(next));
      return next;
    });
  }

  // ── PDF upload ─────────────────────────────────────────────────────────────

  // The delivery address read from the document: a linked quotation must not replace it afterwards
  const addressFromDoc = useRef(false);
  // Fields filled from the document stay highlighted until the user touches them, so each one gets checked
  const [docFilled, setDocFilled] = useState<string[]>([]);
  const markFilled = (keys: string[]) => setDocFilled((p) => [...new Set([...p, ...keys])]);
  const clearFilled = (key: string) => setDocFilled((p) => (p.includes(key) ? p.filter((k) => k !== key) : p));
  const checkRing = (key: string) => (docFilled.includes(key) ? "border-amber-400 bg-amber-50/60 ring-2 ring-amber-300/70 dark:bg-amber-900/10" : "");
  const checkNote = (key: string) => docFilled.includes(key) && (
    <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">Filled from the document. Please check it.</p>
  );
  const poNoRef = useRef(customerPoNo);
  poNoRef.current = customerPoNo;

  async function readDocument(file: File, wantSuggestions: boolean) {
    setPoRead({ status: "loading", fileName: file.name });
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/customer-po/read", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPoRead({ status: "unreadable", fileName: file.name, reason: data.error || "The document could not be read." }); return; }
      if (!data.readable) { setPoRead({ status: "unreadable", fileName: file.name, reason: data.reason || "The document could not be read." }); return; }
      // what the document says fills the form; the user checks it and can change it
      const filled: string[] = [];
      const keys: string[] = [];
      if (data.poNumber && !poNoRef.current.trim()) {
        setCustomerPoNo(data.poNumber); setNoTaken(null); filled.push("customer PO number"); keys.push("poNo");
        void checkNo(data.poNumber);
      }
      if (data.poDate) { setReceivedDate(data.poDate); filled.push("date received"); keys.push("received"); }
      if (data.deliveryDate) { setDeliveryDate(data.deliveryDate); filled.push("due delivery date"); keys.push("due"); }
      if (data.deliveryAddress) { setDeliveryAddress(data.deliveryAddress); addressFromDoc.current = true; filled.push("delivery address"); keys.push("address"); }
      markFilled(keys);
      setPoRead({ status: "done", fileName: file.name, suggestions: wantSuggestions ? data.suggestions ?? [] : [], poNumber: data.poNumber ?? null, poDate: data.poDate ?? null, filled, lines: data.lines ?? [], linked: !wantSuggestions });
    } catch {
      setPoRead({ status: "unreadable", fileName: file.name, reason: "The document could not be read." });
    }
  }

  // The PO's lines, matched to the items by the user's say-so: the PO's wording, order and quantities go onto the items
  // and the items the PO does not list are switched off. Prices are not touched.
  function applyPoLines(res: PoLinesResult) {
    const byKey = new Map(res.matches.filter((m) => m.itemKey).map((m) => [m.itemKey as string, m] as const));
    setItems((prev) => {
      let next = prev.map((i) => {
        const m = byKey.get(i._key);
        if (!m) return i.included ? { ...i, included: false } : i;
        let it: EditableItem = { ...i, included: true, cpoDescription: m.line.description };
        if (m.qtyDiff && !i.setGroupId && m.line.qty) it = calcItemTotal({ ...it, qty: String(m.line.qty), _qtySource: "user", _editedBy: currentUserName || null });
        return it;
      });
      next = sortBySheetOrder(next, res.matches.filter((m) => m.itemKey).map((m) => m.itemKey as string));
      if (!amountOverride) setAmount(sumItems(next));
      return next;
    });
    toast.success(`${byKey.size} PO line${byKey.size === 1 ? "" : "s"} applied to the items${res.notOnPo.length ? `, ${res.notOnPo.length} item${res.notOnPo.length === 1 ? "" : "s"} switched off` : ""}`);
  }

  // Linking a suggestion is the same as typing its number. The suggestions are hidden while any quotation is linked
  // (however it was linked), and come back if it is removed, so a wrong pick is easy to undo.
  async function linkSuggestion(sg: Suggestion) {
    await selectQuotation(sg.id, sg.quotationNo);
  }

  // None of the suggestions is right: take the user to the quotation search, ready to type
  const qtSectionRef = useRef<HTMLDivElement>(null);
  const qtSearchRef = useRef<HTMLInputElement>(null);
  const [qtFlash, setQtFlash] = useState(false);
  function goToQuotationSearch() {
    if (!isFirstQuotation) setShowAddSearch(true);
    requestAnimationFrame(() => {
      qtSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      qtSearchRef.current?.focus({ preventScroll: true });
      setQtFlash(true);
      setTimeout(() => setQtFlash(false), 1600);
    });
  }

  function handlePdfSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so the same file can be picked again
    if (file) void attachFile(file);
  }

  // The customer's PO: stored with the CPO, and (while no quotation is linked) read to suggest which quotation it is
  async function attachFile(file: File) {
    setPdfFile(file);
    setPdfUploading(true);
    // the document is read for its dates and delivery address, and (while no quotation is linked) to suggest the quotation
    void readDocument(file, linkedQuotations.length === 0);
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

  async function handlePoToFollow() {
    if (poTbcLoading) return;
    setPoTbcLoading(true);
    try {
      setCustomerPoNo(await getNextPoTbcNo());
    } catch {
      toast.error("Failed to generate a temporary PO number");
    } finally {
      setPoTbcLoading(false);
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

  // After a failed save, items still missing their CPO description are outlined in red
  const [showDescErrors, setShowDescErrors] = useState(false);

  // asDraft: keep what has been entered so far, however incomplete, to finish and record later
  async function handleSave(asDraft = false) {
    if (asDraft) {
      if (linkedQuotations.length === 0 && !customerPoNo.trim() && items.length === 0) {
        toast.error("Add a customer PO number or a quotation before saving a draft.");
        return;
      }
      // a number that is already used is still worth a warning, though a draft does not hold the number
    } else {
    if (linkedQuotations.length === 0) { toast.error("Please link at least one quotation"); return; }
    if (!customerPoNo.trim()) { toast.error("Customer PO number is required"); return; }
    if (!(await checkNo(customerPoNo))) { toast.error("This customer PO number is already used. Each one must be unique."); return; }
    if (!deliveryAddress.trim()) { toast.error("Delivery address is required"); return; }
    if (!deliveryDate) { toast.error("Due delivery date is required"); return; }
    if (salesPersons.length === 0) { toast.error("Sales person is required"); return; }
    // CPO description is required on every selected item
    const missing = items.length > 0 ? itemsMissingCpoDescription(items) : [];
    if (missing.length > 0) {
      setShowDescErrors(true);
      toast.error(cpoDescriptionMessage(missing), { duration: 10000 });
      setTimeout(() => {
        const el = document.querySelector<HTMLTextAreaElement>(`[data-cpo-desc="${missing[0].key}"]`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        el?.focus({ preventScroll: true });
      }, 0);
      return;
    }
    }
    if (!asDraft) {
      const undecided = unresolvedDifferences(items, dbDescMap);
      if (undecided.length > 0) {
        toast.error(unresolvedMessage(undecided.length), { duration: 10000 });
        setTimeout(() => document.querySelector(`[data-item-row="${undecided[0]._key}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
        return;
      }
    }
    setSaving(true);
    try {
      const primary = linkedQuotations[0];
      await createCustomerPo({
        customerPoNo:    customerPoNo.trim(),
        customerId:      primary?.customerId ?? undefined,
        customerOrgMemberId: primary?.customerOrgMemberId ?? undefined,
        quotationLinks:  linkedQuotations.map((q) => ({ quotationId: q.id, quotationNo: q.quotationNo })),
        items:           items.length > 0
          ? (asDraft ? bookSetPrices(items) : bookSetPrices(items.filter((i) => i.included))).map(({ _key, included, _quotationId, _quotationNo, _origCode, _origDescription, _origDescSource, _codeNotFound, ...rest }) => ({
              ...rest,
              // a draft also keeps the lines that are switched off, so they can be switched on again later
              _excluded:     asDraft && !included ? true : undefined,
              rowNo:         itemNumbers(items).get(_key) ?? rest.rowNo,
              quotationNo:   _quotationNo || undefined,
              originalCode:  rest._codeSource === "user" ? (_origCode?.trim() || undefined) : undefined,
              cpoDescription: rest.cpoDescription?.trim() || undefined,
              setCpoTitle:   rest.setGroupId && !isNotAsSetLabel(rest.setGroupLabel) ? (rest.setCpoTitle?.trim() || undefined) : undefined,
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
        documentKey:     pdfKey,
        salesPersonName: salesPersons[0]?.name || undefined,
        associateSalesPersons: salesPersons.length > 1 ? salesPersons.slice(1).map(({ id, name }) => ({ id, name })) : undefined,
        notes:           notes || undefined,
        receivedDate:    receivedDate ? new Date(receivedDate) : undefined,
        deliveryDate:    deliveryDate ? new Date(deliveryDate) : undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        status: asDraft ? "draft" : status,
      });
      toast.success(asDraft ? "Draft saved. Finish it later from the Customer PO list." : "Customer PO recorded");
      router.push("/dashboard/sales/customer-po");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const computedTotal = sumItems(items);
  const showSearch = isFirstQuotation || showAddSearch;

  return (
    <div className="p-6">
      <PageHeader
        title="Record Customer PO"
        description="Record a purchase order received from a customer"
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
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/sales/customer-po")} className="gap-2">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </Button>
          </div>
        }
      />

      <div className="space-y-5 w-full">

        {/* ── 1. The customer's PO document: attached here, read to suggest the quotation ── */}
        <div className="border border-border rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-sm font-semibold">Customer&apos;s PO document</h2>
            <span className="text-xs text-muted-foreground">(optional) Attach it and we fill in the dates and delivery address, and suggest the matching quotation.</span>
          </div>
          <input ref={pdfRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={handlePdfSelect} />
          {pdfFile ? (
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <PaperclipIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-[13px]">{pdfFile.name}</span>
              {pdfUploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
              {!pdfUploading && pdfKey && <span className="text-xs text-green-600">Attached</span>}
              <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => pdfRef.current?.click()}>Replace</button>
              <button type="button" aria-label="Remove the document" onClick={() => { setPdfFile(null); setPdfKey(undefined); setPoRead({ status: "idle" }); }}>
                <XIcon className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void attachFile(f); }}
              className={cn("flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed px-4 py-4 transition-colors", dragging ? "border-primary bg-primary/5" : "border-border")}
            >
              <PaperclipIcon className="w-5 h-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">Drop the customer&apos;s PO here, or choose a file</div>
                <div className="text-xs text-muted-foreground">PDF (we can read it) or an image (attached only)</div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => pdfRef.current?.click()}>Choose file</Button>
            </div>
          )}
          <PoMatchResults
            result={poRead}
            onLink={linkSuggestion}
            onTypeNumber={goToQuotationSearch}
            hasQuotation={linkedQuotations.length > 0}
            onUsePoNumber={(v) => { setCustomerPoNo(v); setNoTaken(null); }}
            onUseDate={setReceivedDate}
            currentPoNo={customerPoNo}
            currentDate={receivedDate}
            linking={qtLoading}
          />
          {poRead.status === "done" && (
            <PoLinesReview
              lines={poRead.lines}
              items={items.map((i) => ({ key: i._key, productCode: i.productCode || "", description: i.description || "", qty: i.qty, unitPrice: i.unitPrice, included: i.included, inSet: !!i.setGroupId, group: i._quotationNo || undefined, label: `${i.productCode || "—"} ${i.description || ""}`.trim() }))}
              onApply={applyPoLines}
            />
          )}
        </div>

        {/* ── 2. Quotations (required, multiple) ── */}
        <div ref={qtSectionRef} className={cn("border rounded-xl p-4 transition-shadow duration-500", qtFlash ? "border-primary ring-4 ring-primary/20" : "border-border")}>
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

            {/* Quotations of other contacts of the same organization: allowed, so only a gentle reminder */}
            {(() => {
              const others = linkedQuotations.slice(1).filter((q) => q.customerId && primaryCustomer?.customerId && q.customerId !== primaryCustomer.customerId);
              if (!primaryCustomer || others.length === 0) return null;
              return (
                <div role="note" className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/70 px-3 py-2 dark:border-amber-800/50 dark:bg-amber-900/10">
                  <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="text-[11px] leading-snug text-amber-800 dark:text-amber-300">
                    {otherContactsNote(primaryCustomer.customerName, primaryCustomer.customerOrg, others.map((o) => ({ quotationNo: o.quotationNo, customerName: o.customerName })))}
                  </p>
                </div>
              );
            })()}

            {/* Search input — shown for first, or when adding more */}
            {showSearch ? (
              <div className="space-y-1.5">
                <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none z-10" />
                <Input
                  ref={qtSearchRef}
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
                      const custName = (snap ? [snap.title, snap.name].filter(Boolean).join(" ") : "") || qt.customerLabel || null;
                      const alreadyLinked = linkedQuotations.some((q) => q.id === qt.id);
                      const rel = primaryCustomer
                        ? customerRelation(
                            { customerId: primaryCustomer.customerId, orgNames: primaryCustomer.customerOrgNames ?? [primaryCustomer.customerOrg], orgIds: primaryCustomer.customerOrgIds },
                            { customerId: qt.customerId, orgNames: [snap?.organizationName, ...qt.customerOrgs.map((o) => o.name)], orgIds: qt.customerOrgs.map((o) => o.id) },
                          )
                        : "same";
                      const diffCustomer = rel === "different";
                      const otherContact = rel === "same-organization";
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
                              <span className="text-[10px] text-destructive">different organization</span>
                            )}
                            {otherContact && (
                              <span className="text-[10px] text-amber-700 dark:text-amber-400">other contact, same organization</span>
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

        {/* ── 3. PO details ── */}
        <div className="border border-border rounded-xl p-4 space-y-4">
          <h2 className="text-sm font-semibold">PO details</h2>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Customer PO number <span className="text-destructive">*</span></Label>
              <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={poTbcLoading}
                onClick={handlePoToFollow}
                title="The customer has ordered but has not sent its PO yet. Gives a temporary number; replace it when the real PO arrives."
                className="flex items-center gap-1 text-[11px] md:text-[11px] text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 border border-dashed border-amber-400 dark:border-amber-600 rounded px-2 py-0.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {poTbcLoading
                  ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                  : <PlusIcon className="w-3 h-3" />}
                PO to follow
              </button>
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
            </div>
            <Input
              value={customerPoNo}
              onChange={(e) => { setCustomerPoNo(e.target.value); setNoTaken(null); clearFilled("poNo"); }}
              onBlur={(e) => checkNo(e.target.value)}
              aria-invalid={!!noTaken}
              placeholder="e.g. HOSPITAL-PO-2025-001"
              className={cn("h-9", checkRing("poNo"))}
            />
            {checkNote("poNo")}
            {noTaken && (
              <p className="text-[11px] leading-snug text-destructive">
                {noTaken.message}{noTaken.existingId && <> <a className="underline" href={`/dashboard/sales/customer-po/${noTaken.existingId}`} target="_blank" rel="noreferrer">Open it</a></>}
              </p>
            )}
            {/^PO-TBC-/i.test(customerPoNo.trim()) && (
              <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                Temporary number: the customer&apos;s PO has not arrived yet. Replace it with the real PO number when it does.
              </p>
            )}
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
                onChange={(e) => { setReceivedDate(e.target.value); clearFilled("received"); }}
                className={cn("w-full h-9 rounded-md border border-border bg-background px-3 text-sm", checkRing("received"))}
              />
              {checkNote("received")}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Due delivery date <span className="text-destructive">*</span></Label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => { setDeliveryDate(e.target.value); clearFilled("due"); }}
                className={cn("w-full h-9 rounded-md border border-border bg-background px-3 text-sm", checkRing("due"))}
              />
              {checkNote("due")}
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Delivery address <span className="text-destructive">*</span></Label>
              <Textarea
                value={deliveryAddress}
                onChange={(e) => { setDeliveryAddress(e.target.value); clearFilled("address"); }}
                placeholder={"Organization name\nFull address"}
                rows={2}
                className={cn("text-sm resize-none", checkRing("address"))}
              />
              {checkNote("address")}
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

        {/* ── 4. Items (from quotations, editable) ── */}
        {items.length > 0 && (
          <div className="border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Items</h2>
              <div className="flex items-center gap-3">
                <span className="text-[11px] md:text-[11px] text-muted-foreground">
                  {items.filter((i) => i.included).length} of {items.length} selected · edit qty/price to match customer PO
                </span>
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleDownloadSheet}
                  title="Download the items as a spreadsheet, fill the CPO description column, then upload it again">
                  <DownloadIcon className="w-3 h-3" /> Download sheet
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => sheetRef.current?.click()}
                  title="Upload the filled spreadsheet to fill the CPO description of the items">
                  <UploadIcon className="w-3 h-3" /> Upload filled sheet
                </Button>
                <input ref={sheetRef} type="file" accept=".xlsx,.xls,.ods,.csv" className="hidden" onChange={handleUploadSheet} />
              </div>
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
                    <th className="text-left pb-2 pr-2 w-14">#</th>
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
                    const numbers = itemNumbers(items);
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
                        no={numbers.get(item._key)}
                        onCodeChange={handleCodeChange}
                        cpoDescError={showDescErrors}
                        move={canMove(items, item._key)}
                        flash={flashKey === item._key}
                        descState={descriptionState(item, dbDescMap)}
                        onAcceptDescription={acceptDescription}
                        onUseDbDescription={useDatabaseDescription}
                        canRestoreDescription={canRestorePrevious(item, dbDescMap)}
                        onRestoreDescription={restoreDescription}
                        showCustomer={new Set(items.map((x) => x.customerId).filter(Boolean)).size > 1}
                        onMove={handleMove}
                        rowIdx={rowIdx++}
                        inSet={inSet}
                        updateItem={updateItem}
                        onSetLabelChange={handleSetLabelChange}
                        onCellKeyDown={handleCellKeyDown}
                        currentUserName={currentUserName}
                      />
                    );

                    // Render set group header row (editable label, editable qty, removable)
                    const renderGroupHeader = (gid: string) => {
                      const gItems     = items.filter((i) => i.setGroupId === gid && i.included);
                      const first      = items.find((i) => i.setGroupId === gid)!;
                      const groupTotal = setTotal(items, gid);
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
                            {!isNotAsSetLabel(first.setGroupLabel) && (
                              <div className="pl-6 pt-1">
                                <input
                                  value={first.setCpoTitle ?? ""}
                                  onChange={(e) => handleSetTitleChange(gid, e.target.value)}
                                  placeholder="Set title on the customer's PO, e.g. TOILET & SUTURE SET consist of:-"
                                  className="h-6 w-full bg-background border border-blue-200/70 rounded px-1.5 text-[11px] md:text-[11px] text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-blue-300"
                                />
                              </div>
                            )}
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

                    // one block of rows (a set, or the items not in a set): the ticked ones, then a divider and the unticked ones
                    const renderBlock = (list: EditableItem[], inSet: boolean) => {
                      const anyOn = list.some((i) => i.included);
                      let divided = false;
                      for (const i of list) {
                        if (!i.included && anyOn && !divided) {
                          divided = true;
                          rows.push(
                            <tr key={`nx-${i._key}`}>
                              <td colSpan={9} className="pb-1 pt-2.5 pl-7">
                                <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Not included ({list.filter((x) => !x.included).length}) · tick to add to the CPO
                                </span>
                              </td>
                            </tr>,
                          );
                        }
                        rows.push(renderRow(i, inSet));
                      }
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

                    // One combined list: sets first, then every item that is not in a set (across all
                    // quotations), the same order the detail page shows and the # column follows.
                    // Single quotation: render set groups first, then standalone
                    for (const gid of groupOrder) {
                      rows.push(renderGroupHeader(gid));
                      renderBlock(items.filter((i) => i.setGroupId === gid), true);
                      rows.push(renderSpacer(`sp-${gid}`));
                    }
                    const ungrouped = items.filter((i) => !i.setGroupId);
                    if (ungrouped.length > 0) {
                      if (groupOrder.length > 0) rows.push(renderLooseHeader("lh-loose"));
                      renderBlock(ungrouped, false);
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
          <Button onClick={() => handleSave(false)} disabled={saving || pdfUploading}>
            {saving ? "Saving…" : "Record customer PO"}
          </Button>
          <Button variant="outline" onClick={() => handleSave(true)} disabled={saving || pdfUploading} title="Keep what you have entered so far and finish it later">
            Save as draft
          </Button>
          <Button variant="outline" onClick={() => router.push("/dashboard/sales/customer-po")}>
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
  no,
  onCodeChange,
  cpoDescError,
  move,
  onMove,
  rowIdx,
  inSet,
  flash,
  showCustomer,
  descState,
  onAcceptDescription,
  onUseDbDescription,
  canRestoreDescription,
  onRestoreDescription,
  updateItem,
  onSetLabelChange,
  onCellKeyDown,
  currentUserName,
}: {
  item: EditableItem;
  no: number | undefined; // item number in display order (undefined = switched off)
  onCodeChange: (key: string, value: string) => void;
  cpoDescError: boolean; // outline the CPO description in red when it is still empty
  move: { up: boolean; down: boolean };
  flash?: boolean; // just ticked or moved
  descState?: { state: DescriptionState; dbText: string | null }; // the description against the product database
  onAcceptDescription?: (key: string) => void;
  onUseDbDescription?: (key: string) => void;
  canRestoreDescription?: boolean; // the database text is in use and the earlier description is remembered
  onRestoreDescription?: (key: string) => void;
  showCustomer?: boolean; // the CPO has lines of different customers: say whose each line is
  onMove: (key: string, dir: -1 | 1) => void;
  rowIdx: number;
  inSet: boolean;
  updateItem: (key: string, patch: Partial<EditableItem>) => void;
  onSetLabelChange: (key: string, newLabel: string) => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => void;
  currentUserName: string;
}) {
  return (
    <tr data-item-row={item._key} className={cn(
      "border-b border-border/40 last:border-0 transition-[opacity,background-color] [&>td]:align-top",
      !item.included && "opacity-40",
      inSet && "bg-blue-50/20 dark:bg-blue-900/5",
      flash && "bg-indigo-100/70 ring-2 ring-inset ring-indigo-300 dark:bg-indigo-900/30",
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
        <div className="h-7 flex items-center gap-0.5">
          <span className="w-5 tabular-nums">{no ?? "–"}</span>
          <span className="flex flex-col -space-y-1">
            <button type="button" aria-label="Move up" title="Move up" disabled={!move.up}
              onClick={() => onMove(item._key, -1)}
              className="text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-default">
              <ChevronUpIcon className="w-3.5 h-3.5" />
            </button>
            <button type="button" aria-label="Move down" title="Move down" disabled={!move.down}
              onClick={() => onMove(item._key, 1)}
              className="text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-default">
              <ChevronDownIcon className="w-3.5 h-3.5" />
            </button>
          </span>
        </div>
      </td>
      <td className="py-1.5 pr-2">
        <Input
          data-row={rowIdx}
          data-col={0}
          value={item.productCode || ""}
          onChange={(e) => onCodeChange(item._key, e.target.value)}
          onKeyDown={(e) => onCellKeyDown(e, rowIdx, 0)}
          placeholder="code"
          // A plain field until it is changed: the code normally should not be edited, so a change must be hard to miss
          className={cn(
            "h-7 font-mono text-[11px] md:text-[11px]",
            item._codeSource === "user"
              ? "border-2 border-amber-500 bg-amber-100 font-bold text-amber-950 ring-2 ring-amber-300/80 dark:border-amber-500 dark:bg-amber-900/40 dark:text-amber-50"
              : "text-muted-foreground",
          )}
          title={item._codeSource === "user" ? undefined : "The code comes from the quotation. Change it only if it is wrong."}
        />
        {item._codeSource === "user" && (
          <div className="mt-1 flex items-start gap-1 text-[10px] font-medium leading-snug text-amber-700 dark:text-amber-400">
            <AlertTriangleIcon className="mt-px h-3 w-3 shrink-0" />
            <span>
              Code changed{item._origCode !== undefined && item._origCode !== item.productCode ? <> from <span className="font-mono">{item._origCode}</span></> : ""}
            </span>
          </div>
        )}
        {item._codeSource === "quote" && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
            <LinkIcon className="w-3 h-3 shrink-0" />from quotation{item._quotationNo ? ` ${item._quotationNo}` : ""}
          </span>
        )}
        {item._codeSource === "user" && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
            <PencilIcon className="w-3 h-3 shrink-0" />
            {item._editedBy || currentUserName || "user"} edited CPO
          </span>
        )}
      </td>
      <td className="py-1.5 pr-2">
        <div className="space-y-0.5">
          <div className={cn(
            "min-h-7 flex items-center text-[11px] md:text-[11px] whitespace-pre-wrap break-words",
            descState?.state === "differs" && "font-bold text-red-600 dark:text-red-400",
            descState?.state === "accepted" && "font-semibold text-amber-700 dark:text-amber-400",
          )}>{item.description || "—"}</div>
          {item.included && descState?.state === "differs" && (
            <div role="alert" className="space-y-1.5 rounded-md border border-red-200 bg-red-50/80 px-2.5 py-2 text-[10px] leading-snug text-red-900 dark:border-red-800/60 dark:bg-red-900/15 dark:text-red-200">
              <p><span className="font-semibold">Different from the product database</span> for code <span className="font-mono">{item.productCode}</span>. The database says:</p>
              <p className="whitespace-pre-wrap font-medium">{descState.dbText}</p>
              <p className="font-semibold">Is this description intended?</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => onAcceptDescription?.(item._key)} className="rounded border border-red-300 bg-background px-2 py-0.5 text-[10px] font-medium text-red-800 hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-900/30">Yes, keep this description</button>
                <button type="button" onClick={() => onUseDbDescription?.(item._key)} className="rounded border border-border bg-background px-2 py-0.5 text-[10px] font-medium hover:bg-muted">No, use the database description</button>
              </div>
            </div>
          )}
          {item.included && canRestoreDescription && (
            <div className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-[10px] leading-snug text-muted-foreground">
              <p>The database description is in use. Before, it said:</p>
              <p className="whitespace-pre-wrap font-medium text-foreground/80">{item.prevDescription}</p>
              <button type="button" onClick={() => onRestoreDescription?.(item._key)} className="mt-0.5 underline hover:text-foreground">Go back to that description</button>
            </div>
          )}
          {item.included && descState?.state === "accepted" && (
            <div className="rounded-md border border-amber-200 bg-amber-50/80 px-2.5 py-1.5 text-[10px] leading-snug text-amber-900 dark:border-amber-800/60 dark:bg-amber-900/15 dark:text-amber-200">
              <p><span className="font-semibold">Differs from the product database, accepted{item.descAcceptedBy ? ` by ${item.descAcceptedBy}` : ""}.</span> It goes to the sales order as written. If it is changed there, the newest description is the one that continues to the purchase requisition and the supplier PO.</p>
              <button type="button" onClick={() => onUseDbDescription?.(item._key)} className="mt-0.5 underline">Use the database description instead</button>
            </div>
          )}
          {item._codeNotFound && (
            <div className="text-[10px] leading-snug text-amber-700 dark:text-amber-400">
              Code not found in the product database. The description was not changed.
            </div>
          )}
          {(item._descriptionSource ?? []).includes("quote") && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
              <LinkIcon className="w-3 h-3 shrink-0" />from quotation{item._quotationNo ? ` ${item._quotationNo}` : ""}
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
          {showCustomer && item.customerName && (
            <span title={item.customerOrganization ? `${item.customerName}, ${item.customerOrganization}` : item.customerName} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-800">
              <UserIcon className="w-3 h-3 shrink-0" />for {item.customerName}
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
          <div>
            <label className="text-[9px] text-muted-foreground">CPO description <span className="text-destructive">*</span></label>
            <Textarea
              rows={2}
              value={item.cpoDescription ?? ""}
              onChange={(e) => updateItem(item._key, { cpoDescription: e.target.value } as Partial<EditableItem>)}
              placeholder="As written on the customer's PO (required)"
              data-cpo-desc={item._key}
              aria-invalid={cpoDescError && item.included && !(item.cpoDescription ?? "").trim() ? true : undefined}
              className={cn("mt-0.5 min-h-0 py-1 text-[11px] md:text-[11px] leading-snug", cpoDescError && item.included && !(item.cpoDescription ?? "").trim() && "border-destructive focus-visible:ring-destructive/30")}
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
              <LinkIcon className="w-3 h-3 shrink-0" />from quotation{item._quotationNo ? ` ${item._quotationNo}` : ""}
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
          value={isSetPriced(item) ? "" : item.unitPrice}
          placeholder={isSetPriced(item) ? "set price" : undefined}
          disabled={!item.included || isSetPriced(item)}
          onChange={(e) => updateItem(item._key, { unitPrice: e.target.value, _unitPriceSource: "user", _editedBy: currentUserName || null } as Partial<EditableItem>)}
          onKeyDown={(e) => onCellKeyDown(e, rowIdx, 4)}
          className="h-7 text-[11px] md:text-[11px] text-right tabular-nums w-24 ml-auto"
        />
        {item._unitPriceSource === "quote" && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800">
            <LinkIcon className="w-3 h-3 shrink-0" />from quotation{item._quotationNo ? ` ${item._quotationNo}` : ""}
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
          {!item.included
            ? "—"
            : isSetPriced(item)
              ? <span className="text-[10px] font-normal text-muted-foreground">in set price</span>
              : parseFloat(item.totalPrice).toLocaleString("en-MY", { minimumFractionDigits: 2 })}
        </div>
      </td>
    </tr>
  );
}
