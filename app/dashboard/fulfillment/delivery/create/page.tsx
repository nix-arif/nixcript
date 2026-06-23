import { requirePermission } from "@/lib/auth/require-permission";
import { CreateDeliveryOrderClient } from "./create-do-client";
import { getSalesOrderDetail } from "@/server/sales-order";
import { getCustomer } from "@/server/customer";
import { getSoRemainingItems } from "@/server/delivery-order";
import { getDocumentCategories } from "@/server/document-category";

export default async function CreateDeliveryOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ soId?: string; customerPoId?: string }>;
}) {
  await requirePermission("delivery-order:create");
  const { soId, customerPoId } = await searchParams;
  const categories = await getDocumentCategories().catch(() => []);

  let prefill: React.ComponentProps<typeof CreateDeliveryOrderClient>["prefill"] = undefined;

  if (soId) {
    const [so, remaining] = await Promise.all([
      getSalesOrderDetail(soId).catch(() => null),
      getSoRemainingItems(soId).catch(() => []),
    ]);
    if (so) {
      const cpo = customerPoId
        ? so.cpoCustomers.find((c) => c.customerPoId === customerPoId)
        : undefined;

      const customerId = cpo?.customerId ?? so.customerId;
      const customerData = customerId
        ? await getCustomer(customerId).catch(() => null)
        : null;

      const sourceItems = customerPoId
        ? so.items.filter((i) => i.sourceCustomerPoId === customerPoId)
        : so.items;

      const remainingMap = new Map(remaining.map((r) => [r.soItemId, r]));

      prefill = {
        salesOrderId: so.id,
        salesOrderNo: so.soNo,
        soType: so.soType,
        proformaReason: so.proformaReason,
        customerPoId: cpo?.customerPoId,
        customerPoNo: cpo?.customerPoNo,
        customer: customerData ?? null,
        deliveryAddress: so.deliveryAddress ?? "",
        deliveryDate: so.deliveryDate
          ? new Date(so.deliveryDate).toISOString().split("T")[0]
          : "",
        items: sourceItems
          .filter((i) => i.description || i.productCode)
          .map((i, idx) => {
            const rem = remainingMap.get(i.id);
            return {
              rowNo: idx + 1,
              soItemId: i.id,
              originalQty: rem?.originalQty ?? i.qty ?? "1",
              productId: i.productId ?? undefined,
              productCode: i.productCode ?? "",
              description: i.description ?? "",
              qty: rem ? rem.remainingQty : (i.qty ?? "1"),
              uom: i.uom ?? "",
            };
          })
          .filter((item) => parseFloat(item.qty || "0") > 0),
      };
    }
  }

  return <CreateDeliveryOrderClient prefill={prefill} categories={categories} />;
}
