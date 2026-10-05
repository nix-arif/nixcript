import Link from "next/link";
import { WarehouseIcon } from "lucide-react";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { hasNamedWarehouse } from "@/lib/inventory/warehouse-ready";
import { Button } from "@/components/ui/button";

// Every inventory page waits until the company has a named warehouse
export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  const session = await getCachedSession();
  const orgId = session?.session.activeOrganizationId;
  if (!session || !orgId || (await hasNamedWarehouse(orgId))) return children;

  const canSetUp = hasAccess(await getUserPermissions(session.user.id, orgId), "organization-profile:update");
  return (
    <div className="p-6 flex justify-center">
      <div className="max-w-lg w-full rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/10 p-6 space-y-3 mt-10">
        <div className="flex items-center gap-2">
          <WarehouseIcon className="w-5 h-5 text-amber-700 dark:text-amber-400" />
          <h1 className="text-base font-semibold">Set up your warehouse first</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Inventory isn&apos;t available until this company has a warehouse with a name. Stock levels, movements,
          transfers to specialists, delivery orders and consignments all refer to it by that name.
        </p>
        <p className="text-sm text-muted-foreground">
          Add it in <b className="text-foreground">Organization → Organization Profile → Warehouses</b>: a name (e.g. Main Warehouse) and its address.
        </p>
        {canSetUp ? (
          <Button asChild size="sm"><Link href="/dashboard/organization/organization-profile#warehouses">Set up warehouse</Link></Button>
        ) : (
          <p className="text-sm font-medium">Ask an owner or admin of this company to set it up.</p>
        )}
      </div>
    </div>
  );
}
