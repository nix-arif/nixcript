import { requirePermission } from "@/lib/auth/require-permission";
import { CreateDeliveryOrderClient } from "./create-do-client";
import { getSalesOrderDetail } from "@/server/sales-order";
import { getCustomer } from "@/server/customer";

export default async function CreateDeliveryOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ soId?: string; customerPoId?: string }>;
}) {
  await requirePermission("delivery-order:create");
  const { soId, customerPoId } = await searchParams;

  let prefill: React.ComponentProps<typeof CreateDeliveryOrderClient>["prefill"] = undefined;

  if (soId) {
    const so = await getSalesOrderDetail(soId).catch(() => null);
    if (so) {
      // When a specific CPO is requested, filter items and use the CPO's customer
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
          .map((i, idx) => ({
            rowNo: idx + 1,
            productId: i.productId ?? undefined,
            productCode: i.productCode ?? "",
            description: i.description ?? "",
            qty: i.qty ?? "1",
            uom: i.uom ?? "",
          })),
      };
    }
  }

  return <CreateDeliveryOrderClient prefill={prefill} />;
}
