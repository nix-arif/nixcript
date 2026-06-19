import { requirePermission } from "@/lib/auth/require-permission";
import { getSuppliers } from "@/server/supplier";
import { getCustomerPos } from "@/server/customer-purchase-order";
import { getDoForInvoice, getPendingDosForInvoice } from "@/server/delivery-order";
import { getCustomer } from "@/server/customer";
import { getDocumentCategories } from "@/server/document-category";
import { getOrgMembersForInvoice } from "@/server/invoice";
import { getOrganizations } from "@/server/organizations";
import { CreateInvoiceClient, type Customer } from "./create-invoice-client";

export default async function CreateInvoicePage({ searchParams }: { searchParams: Promise<{ doId?: string }> }) {
  const session = await requirePermission("invoice:create");
  const { doId } = await searchParams;
  const activeOrgId = session.session.activeOrganizationId;

  const [suppliers, customerPos, categories, members, pendingDos, orgs] = await Promise.all([
    getSuppliers(),
    getCustomerPos(),
    getDocumentCategories().catch(() => []),
    getOrgMembersForInvoice().catch(() => []),
    doId ? Promise.resolve([]) : getPendingDosForInvoice().catch(() => []),
    getOrganizations().catch(() => []),
  ]);

  const orgName = orgs.find((o) => o.id === activeOrgId)?.name;

  if (!doId) {
    return (
      <CreateInvoiceClient
        suppliers={suppliers}
        allCustomerPos={customerPos}
        categories={categories}
        members={members}
        pendingDos={pendingDos}
        orgName={orgName}
      />
    );
  }

  const doData = await getDoForInvoice(doId).catch(() => null);
  if (!doData) {
    return (
      <CreateInvoiceClient
        suppliers={suppliers}
        allCustomerPos={customerPos}
        categories={categories}
        members={members}
        pendingDos={pendingDos}
        orgName={orgName}
      />
    );
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
      members={members}
      pendingDos={[]}
      orgName={orgName}
    />
  );
}
