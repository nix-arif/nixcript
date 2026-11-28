"use server";

import { db } from "@/db";
import { approvalSetting, member } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { APPROVAL_MODULES, DEFAULT_SELF_ACTION_ALLOWED, OPTIONAL_APPROVAL_KEYS } from "@/lib/approvals/constants";
import { isApprovalRequired } from "@/lib/approvals/required";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";

const ALL_APPROVAL_KEYS = APPROVAL_MODULES.flatMap((m) => m.permissions.map((p) => p.key));

async function requireOwnerOrAdmin() {
  const session = await getCachedSession();
  if (!session) throw new Error("Unauthorized");
  const orgId = session.session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");

  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .limit(1);

  if (!m || !["owner", "admin"].includes(m.role)) throw new Error("Only owners and admins can manage approvals");
  return { orgId };
}

export async function getApprovalSelfActionSettings(): Promise<Record<string, boolean>> {
  const { orgId } = await requireOwnerOrAdmin();

  const rows = await db
    .select({ permissionKey: approvalSetting.permissionKey, selfActionAllowed: approvalSetting.selfActionAllowed })
    .from(approvalSetting)
    .where(and(eq(approvalSetting.organizationId, orgId), inArray(approvalSetting.permissionKey, ALL_APPROVAL_KEYS as unknown as string[])));

  const overrides: Record<string, boolean> = {};
  for (const r of rows) overrides[r.permissionKey] = r.selfActionAllowed;

  const merged: Record<string, boolean> = {};
  for (const key of ALL_APPROVAL_KEYS) merged[key] = overrides[key] ?? DEFAULT_SELF_ACTION_ALLOWED[key] ?? false;
  return merged;
}

export async function setSelfActionAllowed(permissionKey: string, allowed: boolean): Promise<void> {
  const { orgId } = await requireOwnerOrAdmin();
  if (!ALL_APPROVAL_KEYS.includes(permissionKey as never)) throw new Error("Invalid permission key");

  await db
    .insert(approvalSetting)
    .values({ id: nanoid(), organizationId: orgId, permissionKey, selfActionAllowed: allowed })
    .onConflictDoUpdate({
      target: [approvalSetting.organizationId, approvalSetting.permissionKey],
      set: { selfActionAllowed: allowed },
    });

  revalidatePath("/dashboard/admin/approvals");
}

// Read-only, unauthenticated-gate variant for use inside other server
// actions' own guard checks (they already ran their own requireAccess) —
// takes orgId directly instead of resolving it from the caller's session.
export async function isSelfActionAllowed(orgId: string, permissionKey: string): Promise<boolean> {
  const [row] = await db
    .select({ selfActionAllowed: approvalSetting.selfActionAllowed })
    .from(approvalSetting)
    .where(and(eq(approvalSetting.organizationId, orgId), eq(approvalSetting.permissionKey, permissionKey)))
    .limit(1);
  if (row) return row.selfActionAllowed;
  return DEFAULT_SELF_ACTION_ALLOWED[permissionKey] ?? false;
}

// ── Does a document need approval at all (OPTIONAL_APPROVAL_KEYS) ───────────────────────────────

/** { permission key: needs approval } for the keys that can be switched off (the Approvals page) */
export async function getApprovalRequiredSettings(): Promise<Record<string, boolean>> {
  const { orgId } = await requireOwnerOrAdmin();
  const keys = Object.keys(OPTIONAL_APPROVAL_KEYS);
  const rows = await db
    .select({ permissionKey: approvalSetting.permissionKey, required: approvalSetting.approvalRequired })
    .from(approvalSetting)
    .where(and(eq(approvalSetting.organizationId, orgId), inArray(approvalSetting.permissionKey, keys)));
  const out: Record<string, boolean> = {};
  for (const k of keys) out[k] = rows.find((r) => r.permissionKey === k)?.required ?? true;
  return out;
}

export async function setApprovalRequired(permissionKey: string, required: boolean): Promise<void> {
  const { orgId } = await requireOwnerOrAdmin();
  if (!(permissionKey in OPTIONAL_APPROVAL_KEYS)) throw new Error("This approval can't be switched off");
  await db
    .insert(approvalSetting)
    .values({
      id: nanoid(), organizationId: orgId, permissionKey,
      // a new row keeps the self-approval default as it was
      selfActionAllowed: DEFAULT_SELF_ACTION_ALLOWED[permissionKey] ?? false,
      approvalRequired: required,
    })
    .onConflictDoUpdate({
      target: [approvalSetting.organizationId, approvalSetting.permissionKey],
      set: { approvalRequired: required },
    });
  revalidatePath("/dashboard/admin/approvals");
}

/** For the forms (their Submit button says Confirm when no approval is needed): the active company's setting */
export async function approvalRequiredFor(permissionKey: string): Promise<boolean> {
  const session = await getCachedSession();
  const orgId = session?.session?.activeOrganizationId;
  if (!orgId) return true;
  return isApprovalRequired(orgId, permissionKey);
}
