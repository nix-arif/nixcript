"use server";

import { db } from "@/db";
import { warrant2026Config, member } from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { eq, and } from "drizzle-orm";
import { writeToSheet, extractSheetId } from "@/lib/google-sheets";

async function getSession() {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("Unauthorized");
  return {
    orgId: session.session.activeOrganizationId,
    userId: session.user.id,
  };
}

async function requireOwner(orgId: string, userId: string) {
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1);
  if (m?.role !== "owner") throw new Error("Only organization owners can perform this action");
}

export async function getWarrant2026SheetUrl(): Promise<string | null> {
  const { orgId } = await getSession();
  const [cfg] = await db
    .select({ sheetUrl: warrant2026Config.sheetUrl })
    .from(warrant2026Config)
    .where(eq(warrant2026Config.organizationId, orgId))
    .limit(1);
  return cfg?.sheetUrl ?? null;
}

export async function setWarrant2026SheetUrl(url: string): Promise<void> {
  const { orgId, userId } = await getSession();
  await requireOwner(orgId, userId);

  await db
    .insert(warrant2026Config)
    .values({ organizationId: orgId, columns: [], sheetUrl: url, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: warrant2026Config.organizationId,
      set: { sheetUrl: url, updatedAt: new Date() },
    });
}

export async function importXlsxDataToSheet(rows: string[][]): Promise<void> {
  const { orgId, userId } = await getSession();
  await requireOwner(orgId, userId);

  const [cfg] = await db
    .select({ sheetUrl: warrant2026Config.sheetUrl })
    .from(warrant2026Config)
    .where(eq(warrant2026Config.organizationId, orgId))
    .limit(1);

  const sheetUrl = cfg?.sheetUrl;
  if (!sheetUrl) throw new Error("No Google Sheet connected. Connect a sheet first.");

  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) throw new Error("Could not parse sheet ID from the connected URL.");

  await writeToSheet(sheetId, rows);
}
