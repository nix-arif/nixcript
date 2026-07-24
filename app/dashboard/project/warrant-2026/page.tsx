import { getCachedSession } from "@/lib/auth/cached-session";
import { getWarrant2026SheetUrl } from "@/server/warrant";
import { Warrant2026Client } from "./warrant-client";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export default async function Warrant2026Page() {
  const session = await getCachedSession();
  if (!session) redirect("/login");

  const orgId = session.session.activeOrganizationId;
  const userId = session.user.id;

  const [[membership], sheetUrl] = await Promise.all([
    orgId
      ? db
          .select({ role: member.role })
          .from(member)
          .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
          .limit(1)
      : Promise.resolve([]),
    getWarrant2026SheetUrl(),
  ]);

  return (
    <Warrant2026Client
      initialSheetUrl={sheetUrl}
      isOwner={membership?.role === "owner"}
    />
  );
}
