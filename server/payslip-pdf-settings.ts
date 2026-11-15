"use server";

import { db } from "@/db";
import { payslipPdfSetting } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { siblingOrgs } from "@/lib/org/sibling-orgs";
import { mergePdfSettings, type PayslipPdfSettings } from "@/lib/payroll/pdf-settings";

// Anyone who can download a payslip reads the settings; only payslip managers change them.
export async function getPayslipPdfSettings(): Promise<PayslipPdfSettings> {
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  if (!orgId) throw new Error("Unauthorized");
  const [row] = await db.select().from(payslipPdfSetting).where(eq(payslipPdfSetting.organizationId, orgId)).limit(1);
  return mergePdfSettings(row?.settings);
}

export async function savePayslipPdfSettings(input: PayslipPdfSettings): Promise<PayslipPdfSettings> {
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  if (!session || !orgId) throw new Error("Unauthorized");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "payslip:create")) throw new Error("You don't have permission to do this");
  const settings = mergePdfSettings(input);
  await db
    .insert(payslipPdfSetting)
    .values({ organizationId: orgId, settings })
    .onConflictDoUpdate({ target: payslipPdfSetting.organizationId, set: { settings, updatedAt: new Date() } });
  revalidatePath("/dashboard/human-resources/payslip-settings");
  return settings;
}

// Overwrites the PDF settings of the other organizations (same owner) that the caller can manage
async function copyToSiblings(orgId: string, userId: string, settings: PayslipPdfSettings) {
  const orgs = await siblingOrgs(orgId, userId, "payslip:create");
  for (const o of orgs) {
    await db
      .insert(payslipPdfSetting)
      .values({ organizationId: o.id, settings })
      .onConflictDoUpdate({ target: payslipPdfSetting.organizationId, set: { settings, updatedAt: new Date() } });
  }
  return orgs.length;
}

// Other organizations of the same owner this can be applied to
export async function getPdfSiblingOrgs(): Promise<{ id: string; name: string }[]> {
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  if (!session || !orgId) throw new Error("Unauthorized");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "payslip:create")) throw new Error("You don't have permission to do this");
  return siblingOrgs(orgId, session.user.id, "payslip:create");
}

// Apply the currently saved settings to every other organization of the same owner
export async function applyPdfSettingsToAll(): Promise<number> {
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  if (!session || !orgId) throw new Error("Unauthorized");
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "payslip:create")) throw new Error("You don't have permission to do this");
  return copyToSiblings(orgId, session.user.id, await getPayslipPdfSettings());
}
