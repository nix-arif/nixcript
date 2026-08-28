import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { db } from "@/db";
import { product, member, organization } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const EXTS = ["jpg", "jpeg", "png"] as const;
const ROW_HEIGHT = 195;  // points — all data rows are this height
const COL_WIDTH = 39;    // characters — "Picture Ref" column width
const PADDING_PX = 8;    // padding between image and cell border (pixels)

// EMU (English Metric Units): 1 pixel at 96 DPI = 9525 EMU
const EMU = 9525;
const CELL_H_PX = ROW_HEIGHT * (96 / 72);
const CELL_W_PX = COL_WIDTH * 7 + 5;

// Output layout — fixed regardless of what order the uploaded columns were in.
const OUTPUT_HEADERS = [
  "Hospital", "Set Name", "No",
  "Design Brand Name to Refer", "Design Brand Code to Refer", "Best Medical Code to Emboss",
  "Description", "Qty", "OUM", "Picture Ref", "Price/Pc (USD)", "Total Price (USD)",
  "Match Status",
] as const;
const COL = Object.fromEntries(OUTPUT_HEADERS.map((h, i) => [h, i + 1])) as Record<(typeof OUTPUT_HEADERS)[number], number>;
const QTY_COL_LETTER = colIndexToLetter(COL["Qty"]);
const PRICE_COL_LETTER = colIndexToLetter(COL["Price/Pc (USD)"]);

const MISMATCH_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE68A" } }; // amber
const NOTFOUND_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFECACA" } }; // red

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF000000" } },
  left: { style: "thin", color: { argb: "FF000000" } },
  bottom: { style: "thin", color: { argb: "FF000000" } },
  right: { style: "thin", color: { argb: "FF000000" } },
};
// Excel's built-in Accounting format: $ symbol pinned to the cell's left edge,
// thousands separator, 2 decimals, negatives in parentheses, "-" for zero.
const ACCOUNTING_FORMAT = '_-$* #,##0.00_-;-$* #,##0.00_-;_-$* "-"??_-;_-@_-';
const CENTER_ALIGNMENT: Partial<ExcelJS.Alignment> = { vertical: "top", horizontal: "center", wrapText: true };
const LEFT_ALIGNMENT: Partial<ExcelJS.Alignment> = { vertical: "top", wrapText: true };
const TOTAL_ROW_HEIGHT = 32; // taller than the default ~15 so the bold total line has breathing room

// Applies the grid border + top-aligned wrap text every cell in the sheet gets.
// Every column is horizontally centered except "Description", which stays
// left-aligned since it's the one column holding long free-text.
function styleCell(cell: ExcelJS.Cell, colIdx: number) {
  cell.border = THIN_BORDER;
  cell.alignment = colIdx === COL["Description"] ? LEFT_ALIGNMENT : CENTER_ALIGNMENT;
}

function colIndexToLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Read pixel dimensions from a PNG or JPEG buffer without any extra library.
function getImageDimensions(buf: Uint8Array): { w: number; h: number } | null {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const w = ((buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19]) >>> 0;
    const h = ((buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23]) >>> 0;
    return { w, h };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      const segLen = (buf[i + 2] << 8) | buf[i + 3];
      if (marker >= 0xc0 && marker <= 0xc3) {
        const h = (buf[i + 5] << 8) | buf[i + 6];
        const w = (buf[i + 7] << 8) | buf[i + 8];
        return { w, h };
      }
      i += 2 + segLen;
    }
  }
  return null;
}

// Product catalogue images are stored keyed by the product's own productCode
// (see getProductImageUploadUrls in server/products.ts — always `${code}.jpg`,
// "/" swapped for ":"), served off the public CDN, not a DB-tracked key.
async function fetchImageBuffer(productCode: string): Promise<{ buffer: Uint8Array; ext: "jpeg" | "png" } | null> {
  const base = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";
  const encoded = encodeURIComponent(productCode.replace(/\//g, ":"));
  for (const ext of EXTS) {
    const url = `${base}/${encoded}.${ext}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      return { buffer: buf, ext: ext === "png" ? "png" : "jpeg" };
    } catch {
      // try next ext
    }
  }
  return null;
}

// "bolton" (DB) vs "bolton surgical" (what someone typed) should still count
// as the same brand — a plain equality check would flag this as a mismatch
// for no real reason, so this checks containment in either direction after
// normalizing case/whitespace.
function brandNamesMatch(typed: string, dbBrand: string): boolean {
  const a = typed.trim().toLowerCase();
  const b = dbBrand.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function findColumn(headerRow: ExcelJS.Row, needle: string): number {
  let idx = -1;
  headerRow.eachCell((cell, colNumber) => {
    if (typeof cell.value === "string" && cell.value.trim().toLowerCase() === needle) idx = colNumber;
  });
  return idx;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const orgId = session.session.activeOrganizationId;
    if (!orgId) return new NextResponse("No active organization", { status: 400 });

    const perms = await getUserPermissions(session.user.id, orgId);
    if (!hasAccess(perms, "product:read")) return new NextResponse("Forbidden", { status: 403 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const inputBuffer = Buffer.from(await file.arrayBuffer());

    // ── Read input workbook ──────────────────────────────────────────────────
    const inWb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await inWb.xlsx.load(inputBuffer as any);
    const inWs = inWb.worksheets[0];
    if (!inWs) return NextResponse.json({ error: "Spreadsheet has no sheets" }, { status: 400 });

    const headerRow = inWs.getRow(1);
    const inCol = {
      hospital: findColumn(headerRow, "hospital"),
      setName: findColumn(headerRow, "set name"),
      no: findColumn(headerRow, "no"),
      brandName: findColumn(headerRow, "design brand name to refer"),
      brandCode: findColumn(headerRow, "design brand code to refer"),
      emboss: findColumn(headerRow, "best medical code to emboss"),
      qty: findColumn(headerRow, "qty"),
    };
    if (inCol.brandCode === -1) {
      return NextResponse.json({ error: 'No column header "Design Brand Code to Refer" found' }, { status: 400 });
    }

    type InRow = {
      hospital: string; setName: string; no: string;
      brandName: string; brandCode: string; emboss: string; qty: string;
    };
    const cellStr = (row: ExcelJS.Row, colIdx: number): string => {
      if (colIdx === -1) return "";
      const v = row.getCell(colIdx).value;
      return v == null ? "" : String(v).trim();
    };

    const inRows: InRow[] = [];
    for (let r = 2; r <= inWs.rowCount; r++) {
      const row = inWs.getRow(r);
      const brandCode = cellStr(row, inCol.brandCode);
      if (!brandCode) continue; // skip blank/trailing template rows
      inRows.push({
        hospital: cellStr(row, inCol.hospital),
        setName: cellStr(row, inCol.setName),
        no: cellStr(row, inCol.no),
        brandName: cellStr(row, inCol.brandName),
        brandCode,
        emboss: cellStr(row, inCol.emboss),
        qty: cellStr(row, inCol.qty),
      });
    }
    if (inRows.length === 0) {
      return NextResponse.json({ error: "No data rows found under 'Design Brand Code to Refer'" }, { status: 400 });
    }

    // ── Match every row's code against the catalogue in one batched query ────
    // productCode is the org-unique key products are actually stored and
    // imaged under — designBrandCode/designBrandName on `product` are still
    // unpopulated org-wide, so `brand` + `productCode` are the real fields.
    //
    // A supplier PO often references products that live in a sibling company's
    // catalogue rather than the org currently active in this session (e.g. a
    // "bolton" item sourced through a different owned org). Since productCode
    // is only unique per-org, the same code can resolve to different products
    // in different orgs — so this searches every org the caller OWNS (not
    // just anyone they're a member of, to avoid pulling in data from an org
    // where they only hold a limited role) and picks the best candidate per
    // row rather than assuming the active org is authoritative.
    const ownedOrgs = await db
      .select({ organizationId: member.organizationId, orgName: organization.name })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(and(eq(member.userId, session.user.id), eq(member.role, "owner")));
    const searchOrgIds = new Set(ownedOrgs.map((o) => o.organizationId));
    searchOrgIds.add(orgId); // always include the active org even if not "owner" there
    const orgNameById = new Map(ownedOrgs.map((o) => [o.organizationId, o.orgName]));

    const codes = [...new Set(inRows.map((r) => r.brandCode))];
    const matches = await db
      .select({
        productCode: product.productCode,
        brand: product.brand,
        description: product.description,
        uom: product.uom,
        organizationId: product.organizationId,
      })
      .from(product)
      .where(and(inArray(product.organizationId, [...searchOrgIds]), inArray(product.productCode, codes)));

    const candidatesByCode = new Map<string, typeof matches>();
    for (const m of matches) {
      const arr = candidatesByCode.get(m.productCode) ?? [];
      arr.push(m);
      candidatesByCode.set(m.productCode, arr);
    }

    // Prefer whichever candidate's brand actually matches what was typed
    // (even if it's in a different org); otherwise fall back to the active
    // org's candidate; otherwise just the first one found.
    function pickBestMatch(code: string, typedBrand: string) {
      const candidates = candidatesByCode.get(code);
      if (!candidates || candidates.length === 0) return null;
      const brandHit = typedBrand && candidates.find((c) => brandNamesMatch(typedBrand, c.brand ?? ""));
      if (brandHit) return brandHit;
      const activeOrgHit = candidates.find((c) => c.organizationId === orgId);
      if (activeOrgHit) return activeOrgHit;
      return candidates[0];
    }

    // ── Build output workbook ─────────────────────────────────────────────────
    const outWb = new ExcelJS.Workbook();
    const outWs = outWb.addWorksheet(inWs.name || "Sheet1");

    OUTPUT_HEADERS.forEach((h, i) => {
      outWs.getColumn(i + 1).width = h === "Picture Ref" ? COL_WIDTH : h === "Description" ? 40 : 18;
      const cell = outWs.getRow(1).getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true };
      styleCell(cell, i + 1);
    });
    outWs.getRow(1).height = 30;
    outWs.getRow(1).commit();

    const availW = CELL_W_PX - 2 * PADDING_PX;
    const availH = CELL_H_PX - 2 * PADDING_PX;
    let matchedCount = 0, mismatchCount = 0, notFoundCount = 0;

    for (let i = 0; i < inRows.length; i++) {
      const r = i + 2;
      const inRow = inRows[i];
      const outRow = outWs.getRow(r);
      outRow.height = ROW_HEIGHT;

      const match = pickBestMatch(inRow.brandCode, inRow.brandName);
      const matchOrgName = match && match.organizationId !== orgId ? orgNameById.get(match.organizationId) : null;
      let status: "matched" | "mismatch" | "notfound";
      if (!match) {
        status = "notfound";
        notFoundCount++;
      } else if (inRow.brandName && !brandNamesMatch(inRow.brandName, match.brand ?? "")) {
        status = "mismatch";
        mismatchCount++;
      } else {
        status = "matched";
        matchedCount++;
      }

      outRow.getCell(COL["Hospital"]).value = inRow.hospital || null;
      outRow.getCell(COL["Set Name"]).value = inRow.setName || null;
      outRow.getCell(COL["No"]).value = inRow.no || null;
      outRow.getCell(COL["Design Brand Name to Refer"]).value = inRow.brandName || null;
      outRow.getCell(COL["Design Brand Code to Refer"]).value = inRow.brandCode;
      outRow.getCell(COL["Best Medical Code to Emboss"]).value = inRow.emboss || null;
      outRow.getCell(COL["Description"]).value = match?.description ?? null;
      outRow.getCell(COL["Qty"]).value = inRow.qty ? Number(inRow.qty) || inRow.qty : null;
      outRow.getCell(COL["OUM"]).value = match?.uom || "pc";
      outRow.getCell(COL["Total Price (USD)"]).value = {
        formula: `${QTY_COL_LETTER}${r}*${PRICE_COL_LETTER}${r}`,
      };
      outRow.getCell(COL["Price/Pc (USD)"]).numFmt = ACCOUNTING_FORMAT;
      outRow.getCell(COL["Total Price (USD)"]).numFmt = ACCOUNTING_FORMAT;
      const sourceSuffix = matchOrgName ? ` (from ${matchOrgName})` : "";
      outRow.getCell(COL["Match Status"]).value =
        status === "matched" ? `Matched${sourceSuffix}`
        : status === "mismatch" ? `Brand mismatch — catalogue has "${match!.brand}"${sourceSuffix}`
        : "Not found in catalogue";

      if (status === "mismatch") outRow.getCell(COL["Match Status"]).fill = MISMATCH_FILL;
      if (status === "notfound") outRow.getCell(COL["Match Status"]).fill = NOTFOUND_FILL;

      for (let c = 1; c <= OUTPUT_HEADERS.length; c++) styleCell(outRow.getCell(c), c);

      // Only attempt an image fetch when the code actually resolved to a product.
      if (match) {
        const imgResult = await fetchImageBuffer(match.productCode);
        if (imgResult) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const imageId = outWb.addImage({ buffer: imgResult.buffer as any, extension: imgResult.ext });
          const dims = getImageDimensions(imgResult.buffer);
          const picColIdx = COL["Picture Ref"];

          if (dims && dims.w > 0 && dims.h > 0) {
            const scale = Math.min(availW / dims.w, availH / dims.h);
            const imgW = dims.w * scale;
            const imgH = dims.h * scale;
            const offsetX = PADDING_PX + (availW - imgW) / 2;
            const offsetY = PADDING_PX + (availH - imgH) / 2;
            outWs.addImage(imageId, {
              tl: { nativeCol: picColIdx - 1, nativeColOff: Math.round(offsetX * EMU), nativeRow: r - 1, nativeRowOff: Math.round(offsetY * EMU) },
              ext: { width: imgW, height: imgH },
              editAs: "oneCell",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
          } else {
            outWs.addImage(imageId, {
              tl: { nativeCol: picColIdx - 1, nativeColOff: Math.round(PADDING_PX * EMU), nativeRow: r - 1, nativeRowOff: Math.round(PADDING_PX * EMU) },
              br: { nativeCol: picColIdx, nativeColOff: -Math.round(PADDING_PX * EMU), nativeRow: r, nativeRowOff: -Math.round(PADDING_PX * EMU) },
              editAs: "oneCell",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
          }
        }
      }

      outRow.commit();
    }

    // ── Total row ──────────────────────────────────────────────────────────
    const totalRow = outWs.getRow(inRows.length + 2);
    totalRow.height = TOTAL_ROW_HEIGHT;
    // Border every physical cell in the merged span — a merge only hides the
    // value of non-master cells, their own borders still render the perimeter.
    for (let c = 1; c <= OUTPUT_HEADERS.length; c++) styleCell(totalRow.getCell(c), c);
    totalRow.getCell(1).value = "TOTAL PRICE (USD)";
    totalRow.getCell(1).font = { bold: true };
    outWs.mergeCells(totalRow.number, 1, totalRow.number, COL["Total Price (USD)"] - 1);
    const totalCell = totalRow.getCell(COL["Total Price (USD)"]);
    totalCell.value = { formula: `SUM(${PRICE_COL_LETTER === QTY_COL_LETTER ? "" : ""}${colIndexToLetter(COL["Total Price (USD)"])}2:${colIndexToLetter(COL["Total Price (USD)"])}${inRows.length + 1})` };
    totalCell.font = { bold: true };
    totalCell.numFmt = ACCOUNTING_FORMAT;
    totalRow.commit();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outBuffer = await outWb.xlsx.writeBuffer() as any;

    return new NextResponse(outBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="picture-ref.xlsx"',
        "X-Match-Total": String(inRows.length),
        "X-Match-Matched": String(matchedCount),
        "X-Match-Mismatch": String(mismatchCount),
        "X-Match-NotFound": String(notFoundCount),
        "Access-Control-Expose-Headers": "X-Match-Total, X-Match-Matched, X-Match-Mismatch, X-Match-NotFound",
      },
    });
  } catch (err: unknown) {
    console.error("[picture-ref]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
