import { NextRequest } from "next/server";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { generateLedgerExportZip } from "@/lib/ledger-export/generate";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const session = await getCachedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return new Response("No active organization", { status: 400 });
  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "account:read")) return new Response("Forbidden", { status: 403 });

  const body = await req.json();
  const { from, to, includeAttachments = false } = body as {
    from: string;
    to: string;
    includeAttachments?: boolean;
  };

  if (!from || !to) return new Response("Missing from/to dates", { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return new Response("Invalid date format — use YYYY-MM-DD", { status: 400 });
  if (from > to) return new Response("'from' must be on or before 'to'", { status: 400 });

  try {
    const zipBytes = await generateLedgerExportZip(orgId, { from, to, includeAttachments });
    const filename = `Ledger_Export_${from}_to_${to}.zip`;
    return new Response(Buffer.from(zipBytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[ledger/export] Failed:", err);
    return new Response("Export generation failed", { status: 500 });
  }
}
