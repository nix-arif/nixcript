"use server";

import { db } from "@/db";
import { product } from "@/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { nanoid } from "nanoid";
import { eq, and, sql, asc } from "drizzle-orm";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

type ProductRow = {
  productCode: string;
  description?: string;
  unitPrice?: string;
  uom?: string;
  supplier?: string;
  brand?: string;
  registrationNo?: string;
  pageNo?: string;
  validFrom?: string;
  expiredOn?: string;
  pdfFile?: string;
  matchX?: string;
  matchY?: string;
  rowHeight?: string;
  pageWidth?: string;
  pageHeight?: string;
};

export async function seedProducts(rows: ProductRow[]) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");

  //   const perms = await getUserPermissions(session.user.id, orgId);
  //   if (!hasAccess(perms, "product:seed")) throw new Error("Forbidden");

  if (!rows.length) throw new Error("No rows to seed");

  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    if (!row.productCode?.trim()) continue;

    const [existing] = await db
      .select()
      .from(product)
      .where(
        and(
          eq(product.productCode, row.productCode.trim()),
          eq(product.organizationId, orgId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(product)
        .set({
          description: row.description || existing.description,
          unitPrice: row.unitPrice || existing.unitPrice,
          uom: row.uom || existing.uom,
          supplier: row.supplier || existing.supplier,
          brand: row.brand || existing.brand,
          registrationNo: row.registrationNo || existing.registrationNo,
          pageNo: row.pageNo || existing.pageNo,
          validFrom: row.validFrom || existing.validFrom,
          expiredOn: row.expiredOn || existing.expiredOn,
          pdfFile: row.pdfFile || existing.pdfFile,
          matchX: row.matchX || existing.matchX,
          matchY: row.matchY || existing.matchY,
          rowHeight: row.rowHeight || existing.rowHeight,
          pageWidth: row.pageWidth || existing.pageWidth,
          pageHeight: row.pageHeight || existing.pageHeight,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(product.productCode, row.productCode.trim()),
            eq(product.organizationId, orgId),
          ),
        );
      updated++;
    } else {
      await db.insert(product).values({
        id: nanoid(),
        organizationId: orgId,
        productCode: row.productCode.trim(),
        description: row.description,
        unitPrice: row.unitPrice,
        uom: row.uom,
        supplier: row.supplier,
        brand: row.brand,
        registrationNo: row.registrationNo,
        pageNo: row.pageNo,
        validFrom: row.validFrom,
        expiredOn: row.expiredOn,
        pdfFile: row.pdfFile,
        matchX: row.matchX,
        matchY: row.matchY,
        rowHeight: row.rowHeight,
        pageWidth: row.pageWidth,
        pageHeight: row.pageHeight,
      });
      inserted++;
    }
  }

  return { inserted, updated, total: rows.length };
}

export async function getProducts(page = 1, limit = 50) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");

  const offset = (page - 1) * limit;

  const rows = await db
    .select()
    .from(product)
    .where(eq(product.organizationId, orgId))
    .orderBy(asc(product.productCode))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(product)
    .where(eq(product.organizationId, orgId));

  return { rows, total: Number(count), page, limit };
}
