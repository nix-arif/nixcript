import { requirePermission } from "@/lib/auth/require-permission";
import { getSuppliers } from "@/server/supplier";
import { getCustomerPos } from "@/server/customer-purchase-order";
import { CreateInvoiceClient } from "./create-invoice-client";

export default async function CreateInvoicePage() {
  await requirePermission("invoice:create");
  const [suppliers, customerPos] = await Promise.all([
    getSuppliers(),
    getCustomerPos(),
  ]);
  return <CreateInvoiceClient suppliers={suppliers} allCustomerPos={customerPos} />;
}
