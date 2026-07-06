import { requirePermission } from "@/lib/auth/require-permission";
import { getQuotationDetail, getOrgMembersForQuotation, getOwnerOrganizations } from "@/server/quotation";
import { getCustomer } from "@/server/customer";
import { getDocumentCategories } from "@/server/document-category";
import { notFound, redirect } from "next/navigation";
import { NewQuotationClient, type EditData } from "../../new/new-quotation-client";
import type { ReviewItem } from "@/server/quotation";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditQuotationPage({ params }: Props) {
  const session = await requirePermission("quotation:update");
  const { id } = await params;

  const [data, members, categories, ownerOrgs] = await Promise.all([
    getQuotationDetail(id),
    getOrgMembersForQuotation().catch(() => []),
    getDocumentCategories().catch(() => []),
    getOwnerOrganizations().catch(() => []),
  ]);

  if (!data) notFound();
  if (data.quotation.status !== "draft") redirect(`/dashboard/sales/quotation/${id}`);

  const q = data.quotation;

  const initialCustomer = q.customerId
    ? await getCustomer(q.customerId).catch(() => null)
    : null;

  // Derive validDays from createdAt → validUntil
  const validDays = q.validUntil
    ? Math.max(1, Math.round(
        (new Date(q.validUntil).getTime() - new Date(q.createdAt).getTime()) /
        (1000 * 60 * 60 * 24),
      ))
    : 90;

  // Find the matching customerOrgMemberId from the snapshot organisation name
  let customerOrgMemberId = "";
  if (initialCustomer && initialCustomer.memberships.length === 1) {
    customerOrgMemberId = initialCustomer.memberships[0].id;
  } else if (initialCustomer && initialCustomer.memberships.length > 1) {
    const snapshot = q.customerSnapshot as Record<string, string> | null;
    const snapOrgName = snapshot?.organizationName?.toLowerCase().trim();
    const match = initialCustomer.memberships.find(
      (m) => m.orgName?.toLowerCase().trim() === snapOrgName,
    );
    customerOrgMemberId = match?.id ?? initialCustomer.memberships[0]?.id ?? "";
  }

  // Build salesPersons array
  const salesPersons: { id: string; name: string; isExt: boolean }[] = [];
  if (q.salesPersonId || q.salesPersonName) {
    salesPersons.push({
      id: q.salesPersonId ?? "",
      name: q.salesPersonName ?? "",
      isExt: !q.salesPersonId,
    });
  }
  for (const sp of (q.associateSalesPersons ?? [])) {
    salesPersons.push({ id: sp.id, name: sp.name, isExt: !sp.id });
  }

  // Convert DB items to ReviewItem[]
  const items: ReviewItem[] = data.items.map((item) => {
    const hasPrice = !!item.hasPrice;
    const hasCert = !!item.hasCert;
    const status: ReviewItem["status"] =
      item.productCode && !item.productId
        ? "not_found"
        : hasPrice && hasCert
          ? "ok"
          : hasPrice && !hasCert
            ? "no_cert"
            : !hasPrice && hasCert
              ? "no_price"
              : "no_price_no_cert";

    return {
      rowNo: item.rowNo,
      sku: item.sku ?? undefined,
      productCode: item.productCode ?? undefined,
      description: item.description ?? "",
      qty: item.qty,
      uom: item.uom ?? "",
      unitPrice: item.unitPrice ?? "0",
      totalPrice: item.totalPrice ?? "0",
      discountPct: item.discountPct ?? "0",
      discountAmt: item.discountAmt ?? "0",
      computedTotal: (
        Number(item.qty ?? 1) *
        (item.lineType === "rent" ? Number(item.rentalDuration ?? 1) : 1) *
        Number(item.unitPrice ?? 0) *
        (1 - Number(item.discountPct ?? 0) / 100)
      ).toFixed(2),
      lineType: (item.lineType as "sell" | "rent") ?? "sell",
      rentalDuration: item.rentalDuration ?? undefined,
      rentalUnit: item.rentalUnit ?? undefined,
      setGroupId: item.setGroupId ?? undefined,
      setGroupLabel: item.setGroupLabel ?? undefined,
      setQty: item.setQty ?? undefined,
      productId: item.productId ?? undefined,
      productName: item.productName ?? undefined,
      imageKey: item.imageKey ?? undefined,
      mdaRegNo: item.mdaRegNo ?? undefined,
      mdaValidity: item.mdaValidity ?? undefined,
      hasCert,
      hasPrice,
      descriptionSource: (item.descriptionSource as "db" | "sheet" | "user") ?? "db",
      priceSource: (item.priceSource as "db" | "sheet" | "user") ?? "db",
      uomSource: (item.uomSource as "db" | "sheet") ?? "db",
      discountSource: item.discountSource === "user" ? "user" : undefined,
      setQtySource: item.setQtySource === "user" ? "user" : undefined,
      status,
    };
  });

  const editData: EditData = {
    quotationId: id,
    mode: (q.mode as "single" | "comparison") ?? "single",
    title: q.title ?? "Loose Items",
    sets: q.sets ?? 1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customer: initialCustomer as any,
    customerOrgMemberId,
    salesPersons,
    validDays,
    notes: q.notes ?? "",
    deliveryTerm: q.deliveryTerm ?? "EX-STOCK SUBJECT PRIOR SALES, OTHERWISE 8 – 12 WEEKS",
    paymentTerm: q.paymentTerm ?? "30 days",
    returnPolicy: q.returnPolicy ?? "GOODS ONCE SOLD WILL NOT TAKEN BACK",
    warranty: q.warranty ?? "5 years against material and manufacturing defects",
    categoryIds: q.categoryIds ?? [],
    items,
  };

  return (
    <NewQuotationClient
      members={members}
      currentUserId={session.user.id ?? ""}
      currentUserName={session.user.name ?? ""}
      ownerOrgs={ownerOrgs}
      activeOrgId={session.session.activeOrganizationId ?? ""}
      categories={categories}
      editData={editData}
    />
  );
}
