import { requirePermission } from "@/lib/auth/require-permission";
import { getConsignmentBalance, getConsignedInStock, getConsignMoveTargets } from "@/server/consign";
import { ConsignedInStock } from "@/components/consigned-in-stock";
import { PageHeader } from "@/components/page-header";
import { BuildingIcon, HandshakeIcon, HospitalIcon, UserIcon } from "lucide-react";

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const fmtRm = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function ConsignmentBalancePage() {
  await requirePermission("consignment:read");
  const [locations, consignedIn, consignMove] = await Promise.all([
    getConsignmentBalance(), getConsignedInStock().catch(() => []),
    getConsignMoveTargets().catch(() => ({ canMove: false, targets: [] })),
  ]);
  const total = locations.reduce((s, l) => s + l.items.reduce((a, i) => a + i.value, 0), 0);

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <PageHeader title="Consignment balance" description="Your stock placed at agents and customers — still yours, by location — and stock other companies placed with you" />
      {locations.length === 0 ? (consignedIn.length > 0 ? null :
        <div className="border border-dashed border-border rounded-xl py-16 text-center text-sm text-muted-foreground">No stock is out on consignment.</div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-3">{locations.length} location{locations.length !== 1 ? "s" : ""} · value at cost <span className="font-semibold text-foreground">{fmtRm(total)}</span></p>
          <div className="space-y-3">
            {locations.map((loc) => {
              const Icon = loc.kind === "customer" ? HospitalIcon : loc.kind === "agent-rep" ? UserIcon : loc.kind === "partner" ? HandshakeIcon : BuildingIcon;
              const value = loc.items.reduce((a, i) => a + i.value, 0);
              return (
                <section key={loc.label} className="border border-border rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-muted/30 border-b border-border">
                    <div className="flex items-center gap-2 min-w-0 text-sm font-medium"><Icon className="w-4 h-4 text-muted-foreground shrink-0" /><span className="break-words">{loc.name}</span></div>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">{fmtRm(value)}</span>
                  </div>
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-border/60">
                      {loc.items.map((i) => (
                        <tr key={i.productCode}>
                          <td className="px-4 py-2"><span className="font-mono text-xs font-medium">{i.productCode}</span><div className="text-xs text-muted-foreground">{i.description}</div></td>
                          <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{fmtQty(i.qty)} {i.uom ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              );
            })}
          </div>
        </>
      )}
      <div className={locations.length ? "mt-8" : ""}>
        <ConsignedInStock rows={consignedIn} title="Held for others — consigned in" moveTargets={consignMove.targets} canMove={consignMove.canMove} />
      </div>
    </div>
  );
}
