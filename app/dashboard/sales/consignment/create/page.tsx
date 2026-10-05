import { redirect } from "next/navigation";

// Superseded by the Consignment module — keeps a linked sales order.
export default async function CreateSalesConsignmentPage({ searchParams }: { searchParams: Promise<{ soId?: string; soNo?: string }> }) {
  const { soId, soNo } = await searchParams;
  const qs = new URLSearchParams();
  if (soId) qs.set("soId", soId);
  if (soNo) qs.set("soNo", soNo);
  redirect(`/dashboard/consignment/new${qs.size ? `?${qs}` : ""}`);
}
