import { requirePermission } from "@/lib/auth/require-permission";
import { getFieldReps, getMainWarehouseLabel } from "@/server/field-stock";
import { listPartners } from "@/server/consign";
import { TransferClient } from "./transfer-client";

export default async function FieldStockTransferPage() {
  await requirePermission("inventory:create");
  const [reps, mainWarehouseLabel, partners] = await Promise.all([
    getFieldReps(),
    getMainWarehouseLabel(),
    // Dealers / sales agents — only offered to people who may send consignments
    listPartners().then((r) => (r.canEdit ? r.partners.filter((p) => p.active) : [])).catch(() => []),
  ]);
  return (
    <TransferClient reps={reps} mainWarehouseLabel={mainWarehouseLabel}
      partners={partners.map((p) => ({ id: p.id, name: p.name, model: p.model as "dealer" | "sales_agent" }))} />
  );
}
