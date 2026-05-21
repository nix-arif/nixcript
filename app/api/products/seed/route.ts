// import { NextRequest, NextResponse } from "next/server";
// import { auth } from "@/lib/auth";
// import { headers } from "next/headers";
// import { db } from "@/db";
// import { member, product } from "@/db/schema";
// import { nanoid } from "nanoid";
// import { and, eq, sql } from "drizzle-orm";

// export const maxDuration = 60;

// export async function POST(req: NextRequest) {
//   const session = await auth.api.getSession({ headers: await headers() });
//   if (!session)
//     return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

//   const currentOrgId = session.session.activeOrganizationId;
//   if (!currentOrgId)
//     return NextResponse.json(
//       { error: "No active organization" },
//       { status: 400 },
//     );

//   // Always seed under owner's org
//   let ownerOrgId = currentOrgId;
//   const [currentMember] = await db
//     .select()
//     .from(member)
//     .where(
//       and(
//         eq(member.userId, session.user.id),
//         eq(member.organizationId, currentOrgId),
//       ),
//     )
//     .limit(1);

//   if (currentMember?.role !== "owner") {
//     const [ownerMember] = await db
//       .select()
//       .from(member)
//       .where(and(eq(member.userId, session.user.id), eq(member.role, "owner")))
//       .limit(1);
//     if (ownerMember) ownerOrgId = ownerMember.organizationId;
//   }

//   try {
//     const { rows } = await req.json();
//     const validRows = rows.filter((r: any) => r.productCode?.trim());
//     if (!validRows.length)
//       return NextResponse.json({ error: "No valid rows" }, { status: 400 });

//     const values = validRows.map((row: any) => ({
//       id: nanoid(),
//       organizationId: ownerOrgId,
//       productCode: row.productCode.trim(),
//       description: row.description || null,
//       unitPrice: row.unitPrice || null,
//       uom: row.uom || null,
//       supplier: row.supplier || null,
//       brand: row.brand || null,
//       mdaRegistrationNo: row.mdaRegistrationNo || null,
//       mdaPageNo: row.mdaPageNo || null,
//       mdaValidFrom: row.mdaValidFrom || null,
//       mdaExpiredOn: row.mdaExpiredOn || null,
//       mdaPdfFile: row.mdaPdfFile || null,
//       mdaMatchX: row.mdaMatchX || null,
//       mdaMatchY: row.mdaMatchY || null,
//       mdaRowHeight: row.mdaRowHeight || null,
//       mdaPageWidth: row.mdaPageWidth || null,
//       mdaPageHeight: row.mdaPageHeight || null,
//     }));

//     const cleanValues = values.map((row: any) => {
//       // Helper to ensure dates are valid ISO strings or null
//       const formatToIsoString = (dateInput: any) => {
//         if (!dateInput || dateInput === "") return null;
//         const parsedDate = new Date(dateInput);
//         // If the date is invalid, return null to prevent database syntax errors
//         return isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString();
//       };

//       return {
//         ...row,
//         // Explicitly parse strings into clean ISO timestamps
//         mdaValidFrom: formatToIsoString(row.mdaValidFrom),
//         mdaExpiredOn: formatToIsoString(row.mdaExpiredOn),
//       };
//     });

//     await db
//       .insert(product)
//       .values(cleanValues)
//       .onConflictDoUpdate({
//         target: [product.productCode, product.organizationId],
//         set: {
//           description: sql`COALESCE(EXCLUDED.description, ${product.description})`,
//           unitPrice: sql`COALESCE(EXCLUDED.unit_price, ${product.unitPrice})`,
//           uom: sql`COALESCE(EXCLUDED.uom, ${product.uom})`,
//           supplier: sql`COALESCE(EXCLUDED.supplier, ${product.supplier})`,
//           brand: sql`COALESCE(EXCLUDED.brand, ${product.brand})`,
//           mdaRegistrationNo: sql`COALESCE(EXCLUDED.registration_no, ${product.mdaRegistrationNo})`,
//           mdaPageNo: sql`COALESCE(EXCLUDED.page_no, ${product.mdaPageNo})`,
//           mdaValidFrom: sql`COALESCE(EXCLUDED.valid_from, ${product.mdaValidFrom})`,
//           mdaExpiredOn: sql`COALESCE(EXCLUDED.expired_on, ${product.mdaExpiredOn})`,
//           mdaPdfFile: sql`COALESCE(EXCLUDED.pdf_file, ${product.mdaPdfFile})`,
//           mdaMatchX: sql`COALESCE(EXCLUDED.match_x, ${product.mdaMatchX})`,
//           mdaMatchY: sql`COALESCE(EXCLUDED.match_y, ${product.mdaMatchY})`,
//           mdaRowHeight: sql`COALESCE(EXCLUDED.row_height, ${product.mdaRowHeight})`,
//           mdaPageWidth: sql`COALESCE(EXCLUDED.page_width, ${product.mdaPageWidth})`,
//           mdaPageHeight: sql`COALESCE(EXCLUDED.page_height, ${product.mdaPageHeight})`,
//           updatedAt: new Date(),
//         },
//       });

//     return NextResponse.json({ total: validRows.length });
//   } catch (e: any) {
//     console.error("Seed error:", e);
//     return NextResponse.json({ error: e.message }, { status: 500 });
//   }
// }

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { member, product } from "@/db/schema";
import { nanoid } from "nanoid";
import { and, eq, sql } from "drizzle-orm";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const currentOrgId = session.session.activeOrganizationId;
  if (!currentOrgId)
    return NextResponse.json(
      { error: "No active organization" },
      { status: 400 },
    );

  // Always seed under owner's org
  let ownerOrgId = currentOrgId;
  const [currentMember] = await db
    .select()
    .from(member)
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, currentOrgId),
      ),
    )
    .limit(1);

  if (currentMember?.role !== "owner") {
    const [ownerMember] = await db
      .select()
      .from(member)
      .where(and(eq(member.userId, session.user.id), eq(member.role, "owner")))
      .limit(1);
    if (ownerMember) ownerOrgId = ownerMember.organizationId;
  }

  try {
    const { rows } = await req.json();
    const validRows = rows.filter((r: any) => r.productCode?.trim());
    if (!validRows.length)
      return NextResponse.json({ error: "No valid rows" }, { status: 400 });

    // Helper to format string dates to safe ISO strings or null
    const formatToIsoString = (dateInput: any) => {
      if (!dateInput || dateInput === "") return null;

      if (typeof dateInput === "string") {
        // Clean up any extra spaces
        const trimmed = dateInput.trim();

        // Check if it matches the D/M/YYYY or DD/MM/YYYY format
        if (trimmed.includes("/")) {
          const parts = trimmed.split("/");

          if (parts.length === 3) {
            // Assuming format is Day/Month/Year -> parts[0]=Day, parts[1]=Month, parts[2]=Year
            const day = parts[0].padStart(2, "0");
            const month = parts[1].padStart(2, "0");
            const year = parts[2];

            // Rearrange to YYYY-MM-DD which JavaScript parses perfectly
            const isoStyleStr = `${year}-${month}-${day}`;
            const parsedDate = new Date(isoStyleStr);

            return isNaN(parsedDate.getTime())
              ? null
              : parsedDate.toISOString();
          }
        }
      }

      // Fallback for standard ISO strings or native date evaluation
      const parsedDate = new Date(dateInput);
      return isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString();
    };

    // Combine parsing and string date formatting into a single highly efficient map loop
    // Deduplicate by productCode within the batch — Postgres cannot ON CONFLICT UPDATE
    // the same row twice in one statement when the batch itself has duplicates.
    const seen = new Map<string, any>();
    for (const row of validRows) {
      seen.set(row.productCode.trim(), row); // last occurrence wins
    }
    const dedupedRows = [...seen.values()];

    const cleanValues = dedupedRows.map((row: any) => ({
      id: nanoid(),
      organizationId: ownerOrgId,
      productCode: row.productCode.trim(),
      description: row.description || null,
      unitPrice: row.unitPrice || null,
      uom: row.uom || null,
      supplier: row.supplier || null,
      brand: row.brand || null,
      mdaRegistrationNo: row.mdaRegistrationNo || null,
      mdaPageNo: row.mdaPageNo || null,
      mdaValidFrom: formatToIsoString(row.mdaValidFrom),
      mdaExpiredOn: formatToIsoString(row.mdaExpiredOn),
      mdaPdfFile: row.mdaPdfFile || null,
      mdaMatchX: row.mdaMatchX || null,
      mdaMatchY: row.mdaMatchY || null,
      mdaRowHeight: row.mdaRowHeight || null,
      mdaPageWidth: row.mdaPageWidth || null,
      mdaPageHeight: row.mdaPageHeight || null,
    }));

    await db
      .insert(product)
      .values(cleanValues)
      .onConflictDoUpdate({
        target: [product.productCode, product.organizationId],
        set: {
          description: sql`COALESCE(EXCLUDED.description, ${product.description})`,
          unitPrice: sql`COALESCE(EXCLUDED.unit_price, ${product.unitPrice})`,
          uom: sql`COALESCE(EXCLUDED.uom, ${product.uom})`,
          supplier: sql`COALESCE(EXCLUDED.supplier, ${product.supplier})`,
          brand: sql`COALESCE(EXCLUDED.brand, ${product.brand})`,

          // Fixed: Column names inside EXCLUDED now match physical snake_case DB columns
          mdaRegistrationNo: sql`COALESCE(EXCLUDED.mda_registration_no, ${product.mdaRegistrationNo})`,
          mdaPageNo: sql`COALESCE(EXCLUDED.mda_page_no, ${product.mdaPageNo})`,
          mdaValidFrom: sql`COALESCE(EXCLUDED.mda_valid_from, ${product.mdaValidFrom})`,
          mdaExpiredOn: sql`COALESCE(EXCLUDED.mda_expired_on, ${product.mdaExpiredOn})`,
          mdaPdfFile: sql`COALESCE(EXCLUDED.mda_pdf_file, ${product.mdaPdfFile})`,
          mdaMatchX: sql`COALESCE(EXCLUDED.mda_match_x, ${product.mdaMatchX})`,
          mdaMatchY: sql`COALESCE(EXCLUDED.mda_match_y, ${product.mdaMatchY})`,
          mdaRowHeight: sql`COALESCE(EXCLUDED.mda_row_height, ${product.mdaRowHeight})`,
          mdaPageWidth: sql`COALESCE(EXCLUDED.mda_page_width, ${product.mdaPageWidth})`,
          mdaPageHeight: sql`COALESCE(EXCLUDED.mda_page_height, ${product.mdaPageHeight})`,

          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ total: dedupedRows.length });
  } catch (e: any) {
    console.error("Seed error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
