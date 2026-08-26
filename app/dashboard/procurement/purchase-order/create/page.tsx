import { requirePermission } from "@/lib/auth/require-permission";
import { getSuppliers } from "@/server/supplier";
import {
  getApprovedSalesOrders,
  getActiveCustomerPos,
  getPrForPoConversion,
  getDefaultDeliveryAddress,
} from "@/server/purchase-order";
import { getOrganizationProfile } from "@/server/organization-profile";
import { redirect } from "next/navigation";
import { CreatePurchaseOrderClient } from "./create-po-client";

export default async function CreatePurchaseOrderPage({ searchParams }: { searchParams: Promise<{ soId?: string; prId?: string; from?: string }> }) {
  const session = await requirePermission("purchase-order:create");
  const currentUserName = session.user.name ?? "";
  const { soId, prId, from } = await searchParams;
  const backHref = from ? decodeURIComponent(from) : undefined;

  // PR conversion path
  if (prId) {
    const [prData, suppliers, defaultDeliveryAddress, profile] = await Promise.all([
      getPrForPoConversion(prId).catch(() => null),
      getSuppliers(),
      getDefaultDeliveryAddress().catch(() => ""),
      getOrganizationProfile().catch(() => null),
    ]);
    if (!prData) redirect("/dashboard/procurement/requisition");
    return <CreatePurchaseOrderClient suppliers={suppliers} prData={prData} defaultDeliveryAddress={defaultDeliveryAddress} backHref={backHref} currentUserName={currentUserName} businessType={profile?.businessType ?? "trading"} />;
  }

  // Direct creation path
  const [suppliers, approvedSos, customerPos, defaultDeliveryAddress, profile] = await Promise.all([
    getSuppliers(),
    getApprovedSalesOrders(),
    getActiveCustomerPos(),
    getDefaultDeliveryAddress().catch(() => ""),
    getOrganizationProfile().catch(() => null),
  ]);
  return <CreatePurchaseOrderClient suppliers={suppliers} approvedSos={approvedSos} customerPos={customerPos} initialSoId={soId} defaultDeliveryAddress={defaultDeliveryAddress} backHref={backHref} currentUserName={currentUserName} businessType={profile?.businessType ?? "trading"} />;
}
