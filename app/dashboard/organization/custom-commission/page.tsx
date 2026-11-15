import { requirePermission } from "@/lib/auth/require-permission";
import { getCommissionTypes, getOrgMemberOptions } from "@/server/commission";
import { CustomCommissionClient } from "./custom-commission-client";

export default async function CustomCommissionPage() {
  await requirePermission("allowance:manage");
  const [types, members] = await Promise.all([getCommissionTypes(), getOrgMemberOptions()]);
  return <CustomCommissionClient initialTypes={types} members={members} />;
}
