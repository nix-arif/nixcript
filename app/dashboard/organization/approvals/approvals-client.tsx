"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ShieldCheckIcon } from "lucide-react";
import type { ApprovalMember } from "@/server/approvals";
import type { ApprovalModule } from "@/lib/approvals/constants";
import { setApprovalPermission } from "@/server/approvals";

interface Props {
  members: ApprovalMember[];
  modules: readonly ApprovalModule[];
}

export function ApprovalsClient({ members, modules }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState<string | null>(null); // "userId:permKey"

  async function handleToggle(userId: string, permKey: string, currentAllowed: boolean) {
    const key = `${userId}:${permKey}`;
    setPending(key);
    try {
      await setApprovalPermission(userId, permKey, !currentAllowed);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <ShieldCheckIcon className="h-5 w-5 text-muted-foreground" />
          Approval Management
        </h1>
        <p className="text-sm text-muted-foreground">
          Assign members who can approve submissions for each module. Owners bypass this and can approve everything.
        </p>
      </div>

      {/* Module sections */}
      {modules.map(mod => (
        <div key={mod.id} className="rounded-lg border border-border overflow-hidden">
          {/* Module header */}
          <div className="px-5 py-3.5 bg-muted/40 border-b border-border">
            <p className="text-sm font-semibold">{mod.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{mod.description}</p>
          </div>

          {members.length === 0 ? (
            <div className="px-5 py-6 text-sm text-muted-foreground text-center">
              No members to assign.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground w-64">Member</th>
                  {mod.permissions.map(p => (
                    <th key={p.key} className="text-center px-4 py-2.5 text-xs font-medium text-muted-foreground">
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m, idx) => (
                  <tr
                    key={m.userId}
                    className={idx < members.length - 1 ? "border-b border-border/60" : ""}
                  >
                    <td className="px-5 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium leading-none">{m.name}</span>
                        <span className="text-xs text-muted-foreground">{m.email}</span>
                        <Badge variant="outline" className="mt-1 w-fit text-xs px-1.5 py-0 h-4 capitalize">
                          {m.role}
                        </Badge>
                      </div>
                    </td>
                    {mod.permissions.map(p => {
                      const allowed = m.permissions[p.key] === true;
                      const key = `${m.userId}:${p.key}`;
                      return (
                        <td key={p.key} className="px-4 py-3 text-center">
                          <Switch
                            checked={allowed}
                            disabled={pending === key}
                            onCheckedChange={() => handleToggle(m.userId, p.key, allowed)}
                            className="mx-auto"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
