import { requirePermission } from "@/lib/auth/require-permission";
import { listCaseTemplates } from "@/server/case-template";
import { CaseTemplatesClient } from "./case-templates-client";

export default async function CaseTemplatesPage() {
  await requirePermission("delivery-order:read");
  const data = await listCaseTemplates();
  return <CaseTemplatesClient data={data} />;
}
