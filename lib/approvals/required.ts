// Whether a company's document needs approval (Approvals page). Only the keys in
// OPTIONAL_APPROVAL_KEYS can be switched off; everything else always needs it. Server-only.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalSetting } from "@/db/schema";
import { OPTIONAL_APPROVAL_KEYS } from "@/lib/approvals/constants";

export async function isApprovalRequired(orgId: string, permissionKey: string): Promise<boolean> {
  if (!(permissionKey in OPTIONAL_APPROVAL_KEYS)) return true;
  const [row] = await db
    .select({ required: approvalSetting.approvalRequired })
    .from(approvalSetting)
    .where(and(eq(approvalSetting.organizationId, orgId), eq(approvalSetting.permissionKey, permissionKey)))
    .limit(1);
  return row?.required ?? true;
}
