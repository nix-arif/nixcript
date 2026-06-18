import { requirePermission } from "@/lib/auth/require-permission";
import { getSuppliers } from "@/server/supplier";
import { getCustomerPos } from "@/server/customer-purchase-order";
import { getDoForInvoice } from "@/server/delivery-order";
import { getCustomer } from "@/server/customer";
import { redirect } from "next/navigation";
import { CreateInvoiceClient, type Customer } from "./create-invoice-client";

export default async function CreateInvoicePage({ searchParams }: { searchParams: Promise<{ doId?: string }> }) {
  await requirePermission("invoice:create");
  const { doId } = await searchParams;

  const [suppliers, customerPos] = await Promise.all([
    getSuppliers(),
    getCustomerPos(),
  ]);

  if (!doId) {
    return <CreateInvoiceClient suppliers={suppliers} allCustomerPos={customerPos} />;
  }

  const doData = await getDoForInvoice(doId).catch(() => null);
  if (!doData) {
    return <CreateInvoiceClient suppliers={suppliers} allCustomerPos={customerPos} />;
  }

  const initialCustomer = doData.customerId
    ? (await getCustomer(doData.customerId).catch(() => null)) as Customer | null
    : null;

  return (
    <CreateInvoiceClient
      suppliers={suppliers}
      allCustomerPos={customerPos}
      doData={doData}
      initialCustomer={initialCustomer}
    />
  );
}
