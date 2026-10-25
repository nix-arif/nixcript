import { notFound } from "next/navigation";
import { getCachedSession as getSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { requirePermission } from "@/lib/auth/require-permission";
import { getPackingListLabels } from "@/server/packing-list";
import { getLabelTemplate } from "@/server/label-template";
import { LabelsClient } from "./labels-client";

export default async function PackingListLabelsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("purchase-order:read");
  const { id } = await params;
  const [data, template, permissions] = await Promise.all([
    getPackingListLabels(id),
    getLabelTemplate().catch(() => null),
    getSession().then((s) => getUserPermissions(s!.user.id, s!.session.activeOrganizationId!)),
  ]);
  if (!data) notFound();
  return (
    <LabelsClient
      packingListId={id}
      packingListNo={data.packingListNo}
      labels={data.labels}
      savedDesign={template}
      canSaveTemplate={hasAccess(permissions, "purchase-order:update")}
    />
  );
}
