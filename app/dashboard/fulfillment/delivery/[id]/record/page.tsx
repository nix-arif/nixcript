import { requirePermission } from "@/lib/auth/require-permission";
import { getDeliveryOrderDetail } from "@/server/delivery-order";
import { getCaseTemplatesForCustomer } from "@/server/case-template";
import { getDocumentCategories } from "@/server/document-category";
import { redirect } from "next/navigation";
import { RecordCaseActualsForm } from "../../create/create-do-client";

// After the case: record what was actually used from the specialist's field
// stock (two-step Case DO). Stock is deducted when recorded.
export default async function RecordCaseActualsPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("delivery-order:update");
  const { id } = await params;
  const order = await getDeliveryOrderDetail(id);
  if (!order) redirect("/dashboard/fulfillment/delivery");
  if (!order.isCaseDo || order.actualStatus !== "pending" || !order.applicationSpecialistId) redirect(`/dashboard/fulfillment/delivery/${id}`);

  const [templates, categories] = await Promise.all([
    order.customerId ? getCaseTemplatesForCustomer(order.customerId).catch(() => []) : Promise.resolve([]),
    getDocumentCategories().catch(() => []),
  ]);
  const cust = order.customerSnapshot as { title?: string; name?: string } | null;

  return (
    <RecordCaseActualsForm
      categories={categories}
      recordFor={{
        doId: order.id, doNo: order.doNo,
        specialistId: order.applicationSpecialistId, specialistName: order.applicationSpecialistName ?? "Specialist",
        customerName: cust ? [cust.title, cust.name].filter(Boolean).join(" ") : null,
        caseDate: order.caseDate ? new Date(order.caseDate).toISOString() : null,
        caseDescription: order.caseDescription,
        items: order.customerItems.map((c) => ({ productId: c.productId, productCode: c.productCode, description: c.description, qty: c.qty, uom: c.uom })),
        template: templates.find((t) => t.id === order.caseTemplateId) ?? null,
      }}
    />
  );
}
