import { requirePermission } from "@/lib/auth/require-permission";
import { getReviewTemplates } from "@/server/performance";
import { TemplatesClient } from "./templates-client";

export default async function ReviewTemplatesPage() {
  await requirePermission("review:manage");
  return <TemplatesClient initial={await getReviewTemplates()} />;
}
