import { db } from "@/db";
import { restrictedSupplier, member, organization, supplier } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

// Supplier rules (server/supplier-restrictions.ts) say that a real supplier is dealt with by ONE of the
// owner's organizations. Instead of refusing the other organizations, they are routed: the PO / PR line
// goes to the designated sibling organization, which already knows how to turn a PO into its own Sales
// Order (supplier.linkedOrganizationId -> maybeCreateIntercompanySalesOrder). The designated organization
// then orders from the real supplier itself.

export type SupplierRoute = {
  supplierId: string; // this organization's supplier record that stands for the designated organization
  supplierName: string; // that record's name (the designated organization's name)
  designatedOrgId: string;
  designatedOrgName: string;
  originalName: string; // the restricted supplier the user picked
  note: string;
};

export async function routeRestrictedSupplier(
  orgId: string,
  supplierName: string | null | undefined,
  createdBy: string,
  opts: { dryRun?: boolean } = {}, // dryRun: only look, do not make the stand-in supplier record (supplierId is "" then)
): Promise<SupplierRoute | null> {
  const name = supplierName?.trim();
  if (!name) return null;

  const [ownerRow] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner"), isNull(member.deletedAt)))
    .limit(1);
  if (!ownerRow) return null;

  const [rule] = await db
    .select({ designatedOrganizationId: restrictedSupplier.designatedOrganizationId, supplierName: restrictedSupplier.supplierName })
    .from(restrictedSupplier)
    .where(and(eq(restrictedSupplier.ownerUserId, ownerRow.userId), eq(restrictedSupplier.supplierNameNormalized, name.toLowerCase())));
  if (!rule || rule.designatedOrganizationId === orgId) return null;

  const [designated] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, rule.designatedOrganizationId));
  if (!designated) return null;

  // this organization's supplier record that stands for the designated organization (made once, then reused)
  let [stand] = await db
    .select({ id: supplier.id, name: supplier.name })
    .from(supplier)
    .where(and(eq(supplier.organizationId, orgId), eq(supplier.linkedOrganizationId, rule.designatedOrganizationId)))
    .limit(1);
  if (!stand && opts.dryRun) {
    stand = { id: "", name: designated.name };
  } else if (!stand) {
    [stand] = await db
      .insert(supplier)
      .values({
        id: nanoid(),
        organizationId: orgId,
        name: designated.name,
        linkedOrganizationId: rule.designatedOrganizationId,
        createdBy,
      })
      .returning({ id: supplier.id, name: supplier.name });
  }

  return {
    supplierId: stand.id,
    supplierName: stand.name,
    designatedOrgId: rule.designatedOrganizationId,
    designatedOrgName: designated.name,
    originalName: rule.supplierName,
    note: `"${rule.supplierName}" is handled by ${designated.name}, so this order is issued to ${designated.name}.`,
  };
}

export const joinNotes = (...parts: (string | null | undefined)[]) => parts.filter((p) => p && p.trim()).join("\n");
