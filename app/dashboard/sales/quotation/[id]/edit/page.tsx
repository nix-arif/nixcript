import { requirePermission } from "@/lib/auth/require-permission";
import { getQuotationDetail } from "@/server/quotation";
import { getCustomers } from "@/server/customer";
import { getOrgMembersForQuotation } from "@/server/quotation";
import { getDocumentCategories } from "@/server/document-category";
import { notFound, redirect } from "next/navigation";
import { EditQuotationClient } from "./edit-quotation-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditQuotationPage({ params }: Props) {
  await requirePermission("quotation:update");
  const { id } = await params;

  const [data, customers, members, categories] = await Promise.all([
    getQuotationDetail(id),
    getCustomers(),
    getOrgMembersForQuotation().catch(() => []),
    getDocumentCategories().catch(() => []),
  ]);

  if (!data) notFound();
  if (data.quotation.status !== "draft") redirect(`/dashboard/sales/quotation/${id}`);

  return <EditQuotationClient data={data} customers={customers} members={members} categories={categories} />;
}
