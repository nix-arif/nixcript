import { requirePermission } from "@/lib/auth/require-permission";
import { getSuppliers } from "@/server/supplier";
import { getCustomerPos } from "@/server/customer-purchase-order";
import { getDoForInvoice } from "@/server/delivery-order";
import { getCustomer } from "@/server/customer";
import { getDocumentCategories } from "@/server/document-category";
import { redirect } from "next/navigation";
import { CreateInvoiceClient, type Customer } from "./create-invoice-client";

export default async function CreateInvoicePage({ searchParams }: { searchParams: Promise<{ doId?: string }> }) {
  await requirePermission("invoice:create");
  const { doId } = await searchParams;

  const [suppliers, customerPos, categories] = await Promise.all([
    getSuppliers(),
    getCustomerPos(),
    getDocumentCategories().catch(() => []),
  ]);

  if (!doId) {
    return <CreateInvoiceClient suppliers={suppliers} allCustomerPos={customerPos} categories={categories} />;
  }

  const doData = await getDoForInvoice(doId).catch(() => null);
  if (!doData) {
    return <CreateInvoiceClient suppliers={suppliers} allCustomerPos={customerPos} categories={categories} />;
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
      categories={categories}
    />
  );
}
