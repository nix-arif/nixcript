import { getCachedSession } from "@/lib/auth/cached-session";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getApprovalMembers, APPROVAL_MODULES } from "@/server/approvals";
import { ApprovalsClient } from "./approvals-client";

export default async function ApprovalsPage() {
  const session = await getCachedSession();
  if (!session) redirect("/auth/sign-in");

  const orgId = session.session.activeOrganizationId;
  if (!orgId) redirect("/dashboard");

  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, orgId), isNull(member.deletedAt)))
    .limit(1);

  if (!m || !["owner", "admin"].includes(m.role)) redirect("/dashboard");

  const members = await getApprovalMembers();

  return <ApprovalsClient members={members} modules={APPROVAL_MODULES} />;
}
