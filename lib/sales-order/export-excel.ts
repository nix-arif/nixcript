// The Sales Order as an Excel sheet (header, customer, items, totals) — the
// "Excel" button on both the SO page and its edit page. Browser only (saves a file).
import * as XLSX from "xlsx";
import type { SalesOrderWithItems } from "@/server/sales-order";

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function exportSalesOrderExcel(order: SalesOrderWithItems, opts: { statusLabel: string; showSourcing: boolean }) {
  const { showSourcing } = opts;
  const snap = order.customerSnapshot as { title?: string; name?: string; organizationName?: string } | null;
  const custName = snap ? [snap.title, snap.name].filter(Boolean).join(" ") : null;

    const rows: (string | number)[][] = [];

    rows.push([`Sales Order ${order.soNo}`]);
    rows.push([`Status: ${opts.statusLabel}`, `Date: ${fmtDate(order.createdAt)}`]);
    rows.push([]);
    rows.push(["Customer", custName || "—", "Organization", snap?.organizationName || "—"]);
    rows.push(["Sales Person", order.salesPersonName || "—", "Due Delivery Date", fmtDate(order.deliveryDate)]);
    if (order.deliveryAddress) rows.push(["Delivery Address", order.deliveryAddress]);
    rows.push([]);

    const header = ["#", "Code"];
    if (showSourcing) header.push("Design Brand", "Design Code", "Emboss Code");
    header.push("Description", "Qty", "UOM", "Unit Price", "Disc %", "Total");
    const colCount = header.length;
    rows.push(header);

    for (const item of order.items) {
      const row: (string | number)[] = [item.rowNo, item.productCode ?? ""];
      if (showSourcing) row.push(item.designBrandName ?? "", item.designBrandCode ?? "", item.privateLabelCode ?? "");
      row.push(
        item.description ?? "",
        Number(item.qty ?? 0),
        item.uom ?? "",
        Number(item.unitPrice ?? 0),
        Number(item.discountPct ?? 0),
        Number(item.totalPrice ?? 0),
      );
      rows.push(row);
    }

    rows.push([]);
    const footer = (label: string, value: number) => {
      const r: (string | number)[] = new Array(colCount - 2).fill("");
      r.push(label, value);
      return r;
    };
    rows.push(footer("Subtotal", Number(order.subtotal ?? 0)));
    if (parseFloat(order.overallDiscountPct ?? "0") > 0) {
      rows.push(footer(`Discount (${order.overallDiscountPct}%)`, -Number(order.overallDiscountAmt ?? 0)));
    }
    if (parseFloat(order.sstPct ?? "0") > 0) {
      rows.push(footer(`SST (${order.sstPct}%)`, Number(order.sst ?? 0)));
    }
    rows.push(footer("Grand Total", Number(order.grandTotal ?? 0)));

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = header.map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Order");
    XLSX.writeFile(wb, `${order.soNo}.xlsx`);
  }
