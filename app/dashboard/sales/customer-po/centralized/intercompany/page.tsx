import { requirePermission } from "@/lib/auth/require-permission";
import { getCustomerPosCentralized } from "@/server/customer-purchase-order";
import { CentralizedCustomerPoClient } from "../centralized-po-client";

// Intercompany POs: the Customer POs auto-created in a receiving org when a
// sibling org confirms a PO to it — kept off the centralized Customer POs
// page so that list shows real customers only.
export default async function CentralizedIntercompanyPoPage() {
  await requirePermission("customer-po:read:centralized");
  const pos = await getCustomerPosCentralized("intercompany");
  return <CentralizedCustomerPoClient initialPos={pos} kind="intercompany" />;
}
