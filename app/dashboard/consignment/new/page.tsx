import { requirePermission } from "@/lib/auth/require-permission";
import { getConsignmentFormOptions } from "@/server/consign";
import { NewConsignmentClient } from "./new-consignment-client";

export default async function NewConsignmentPage({ searchParams }: { searchParams: Promise<{ soId?: string; soNo?: string }> }) {
  await requirePermission("consignment:manage");
  const [options, sp] = await Promise.all([getConsignmentFormOptions(), searchParams]);
  return <NewConsignmentClient options={options} soId={sp.soId ?? null} soNo={sp.soNo ?? null} />;
}
