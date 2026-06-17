import { requirePermission } from "@/lib/auth/require-permission";
import { LedgerExportClient } from "./export-client";

export default async function LedgerExportPage() {
  await requirePermission("account:read");
  return <LedgerExportClient />;
}
