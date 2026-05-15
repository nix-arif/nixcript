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

    const values = validRows.map((row: any) => ({
      id: nanoid(),
      organizationId: ownerOrgId,
      productCode: row.productCode.trim(),
      description: row.description || null,
      unitPrice: row.unitPrice || null,
      uom: row.uom || null,
      supplier: row.supplier || null,
      brand: row.brand || null,
      registrationNo: row.registrationNo || null,
      pageNo: row.pageNo || null,
      validFrom: row.validFrom || null,
      expiredOn: row.expiredOn || null,
      pdfFile: row.pdfFile || null,
      matchX: row.matchX || null,
      matchY: row.matchY || null,
      rowHeight: row.rowHeight || null,
      pageWidth: row.pageWidth || null,
      pageHeight: row.pageHeight || null,
    }));

    await db
      .insert(product)
      .values(values)
      .onConflictDoUpdate({
        target: [product.productCode, product.organizationId],
        set: {
          description: sql`COALESCE(EXCLUDED.description, ${product.description})`,
          unitPrice: sql`COALESCE(EXCLUDED.unit_price, ${product.unitPrice})`,
          uom: sql`COALESCE(EXCLUDED.uom, ${product.uom})`,
          supplier: sql`COALESCE(EXCLUDED.supplier, ${product.supplier})`,
          brand: sql`COALESCE(EXCLUDED.brand, ${product.brand})`,
          registrationNo: sql`COALESCE(EXCLUDED.registration_no, ${product.registrationNo})`,
          pageNo: sql`COALESCE(EXCLUDED.page_no, ${product.pageNo})`,
          validFrom: sql`COALESCE(EXCLUDED.valid_from, ${product.validFrom})`,
          expiredOn: sql`COALESCE(EXCLUDED.expired_on, ${product.expiredOn})`,
          pdfFile: sql`COALESCE(EXCLUDED.pdf_file, ${product.pdfFile})`,
          matchX: sql`COALESCE(EXCLUDED.match_x, ${product.matchX})`,
          matchY: sql`COALESCE(EXCLUDED.match_y, ${product.matchY})`,
          rowHeight: sql`COALESCE(EXCLUDED.row_height, ${product.rowHeight})`,
          pageWidth: sql`COALESCE(EXCLUDED.page_width, ${product.pageWidth})`,
          pageHeight: sql`COALESCE(EXCLUDED.page_height, ${product.pageHeight})`,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ total: validRows.length });
  } catch (e: any) {
    console.error("Seed error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
