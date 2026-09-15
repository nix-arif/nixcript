"use server";

import { db } from "@/db";
import { member, product, organization } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { createApprovedMovement } from "@/lib/inventory/create-movement";
import { getMainWarehouseLabel } from "@/server/field-stock";
import { MOVEMENT_TYPE, REF_TYPE, consignedWarehouseLabel, consignedFieldWarehouseLabel } from "@/lib/inventory/constants";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

async function requireAccess(permission: string) {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, permission)) throw new Error("Forbidden");
  return { orgId, userId: session.user.id };
}

// Every org owned by the same owner as orgId — same "owner org group"
// pattern duplicated across server/inventory.ts, server/field-stock.ts,
// server/delivery-order.ts, server/document-category.ts etc.
async function getOwnerOrgIds(orgId: string): Promise<string[]> {
  const [ownerMember] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner"), isNull(member.deletedAt)))
    .limit(1);
  if (!ownerMember) return [orgId];
  const owned = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner"), isNull(member.deletedAt)));
  const ids = [...new Set(owned.map((m) => m.organizationId))];
  return ids.length > 0 ? ids : [orgId];
}

// The caller's sibling orgs (same owner, excluding the active one) — for
// populating the "consign to" picker. Gated the same as the transfer action
// itself so anyone who can send consignment stock can also see the choices.
export async function getSiblingOrgsForConsignment(): Promise<{ id: string; name: string }[]> {
  const { orgId } = await requireAccess("inventory:manage");
  const siblingIds = (await getOwnerOrgIds(orgId)).filter((id) => id !== orgId);
  if (siblingIds.length === 0) return [];
  return db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, siblingIds));
}

export interface ConsignStockInput {
  toOrgId: string;
  productId: string;
  quantity: number;
  // Omit to land in the receiving org's own "Consigned:<sender>" warehouse
  // bucket; provide to hand it straight to one of that org's field reps.
  destinationRepId?: string;
  sourceWarehouseLabel?: string; // defaults to the sender org's own configured main warehouse
  notes?: string;
}

// Ships stock from the caller's org to a sibling org as consignment —
// ownership stays with the sender (see lib/inventory/constants.ts's
// consignedWarehouseLabel/consignedFieldWarehouseLabel comment). This is
// deliberately NOT a purchase transaction: no PO/SO/invoice is created,
// just a paired stock-out (sender) / stock-in (receiver) movement, each
// auto-approved via the same createApprovedMovement helper GR/DO already use.
export async function consignStockToSiblingOrg(input: ConsignStockInput): Promise<void> {
  const { orgId, userId } = await requireAccess("inventory:manage");

  if (input.quantity <= 0) throw new Error("Quantity must be greater than zero");
  if (input.toOrgId === orgId) throw new Error("Destination must be a different (sibling) organization");

  const ownerOrgIds = await getOwnerOrgIds(orgId);
  if (!ownerOrgIds.includes(input.toOrgId)) throw new Error("You can only consign stock to one of your own organizations");

  const [prod] = await db
    .select({ productCode: product.productCode })
    .from(product)
    .where(and(eq(product.id, input.productId), inArray(product.organizationId, ownerOrgIds)))
    .limit(1);
  if (!prod) throw new Error("Product not found");

  const referenceNo = `CONSIGN-${nanoid(8)}`;
  const sourceLabel = input.sourceWarehouseLabel?.trim() || await getMainWarehouseLabel();
  const destinationLabel = input.destinationRepId
    ? consignedFieldWarehouseLabel(input.destinationRepId, orgId)
    : consignedWarehouseLabel(orgId);

  await createApprovedMovement({
    orgId, userId, productId: input.productId, warehouseLabel: sourceLabel,
    movementType: MOVEMENT_TYPE.STOCK_OUT, quantity: input.quantity,
    referenceType: REF_TYPE.CONSIGNMENT, referenceId: referenceNo, referenceNo,
    notes: `Consigned to sibling org — ${referenceNo}${input.notes ? `: ${input.notes.trim()}` : ""}`,
  });

  await createApprovedMovement({
    orgId: input.toOrgId, userId, productId: input.productId, warehouseLabel: destinationLabel,
    movementType: MOVEMENT_TYPE.STOCK_IN, quantity: input.quantity,
    referenceType: REF_TYPE.CONSIGNMENT, referenceId: referenceNo, referenceNo,
    notes: `Consigned from sibling org — ${referenceNo}${input.notes ? `: ${input.notes.trim()}` : ""}`,
  });
}
