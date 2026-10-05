"use client";

// Live refresh — open pages pick up other people's changes without a reload.
// Asks /api/live "has anything changed?" (a tiny read of change counters kept
// by database triggers) when the tab comes back into view and every 30 s
// while it is visible; only when a counter moved does it re-fetch the page's
// data (router.refresh — typed-in form state is kept). Hidden tabs don't ask.
//
// The same check keeps each tab on its own company: the login session holds a
// single active company shared by all tabs, so when another tab switched it,
// this tab switches it back (lib/tab-org.ts) as soon as the user returns here —
// before anything can be clicked — instead of quietly showing the other
// company's data under this tab's company name.

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { getTabOrg, setTabOrg, TAB_ORG_RESTORED } from "@/lib/tab-org";
import { Spinner } from "@/components/ui/spinner";

const INTERVAL_MS = 30_000;

// Which areas each page shows. Forms (create / new / edit) are left alone.
const RULES: [RegExp, string[]][] = [
  [/^\/dashboard\/?$/, ["quotation", "sales", "delivery", "invoice", "inventory", "consignment", "purchase"]],
  [/^\/dashboard\/sales\/quotation/, ["quotation", "customer"]],
  [/^\/dashboard\/sales\/(order|customer-po)/, ["sales", "quotation", "delivery", "invoice"]],
  [/^\/dashboard\/sales\/customer/, ["customer"]],
  [/^\/dashboard\/fulfillment\/delivery/, ["delivery", "inventory", "invoice", "consignment"]],
  [/^\/dashboard\/fulfillment\/(invoice|soa)/, ["invoice", "delivery"]],
  [/^\/dashboard\/inventory/, ["inventory", "consignment", "delivery"]],
  [/^\/dashboard\/consignment/, ["consignment", "inventory", "invoice", "purchase"]],
  [/^\/dashboard\/procurement\/supplier/, ["supplier"]],
  [/^\/dashboard\/procurement/, ["purchase", "inventory"]],
  [/^\/dashboard\/human-resources\/(claim|leave|travel)/, ["hr"]],
];
const FORM = /\/(create|new|edit)(\/|$)/;

function scopesFor(path: string): string {
  if (FORM.test(path)) return "";
  return RULES.find(([re]) => re.test(path))?.[1].join(",") ?? "";
}

export function LiveRefresh() {
  const pathname = usePathname();
  const router = useRouter();
  const scopes = scopesFor(pathname);
  const [restoring, setRestoring] = useState<string | null>(null);
  const { data: orgs } = authClient.useListOrganizations();

  useEffect(() => {
    let last: string | null = null; // the counters this page was rendered with
    let busy = false;
    let alive = true;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const res = await fetch(`/api/live?scopes=${scopes}`, { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { org: string; v: Record<string, number> };
        const mine = getTabOrg();
        if (!mine) setTabOrg(data.org);
        else if (data.org !== mine) {
          // Another tab switched company. Only the tab in use puts it back —
          // a tab in the background waits until the user returns to it.
          if (!document.hasFocus()) return;
          setRestoring(mine);
          try {
            const r = await authClient.organization.setActive({ organizationId: mine });
            if (r?.error) throw r.error;
          } catch {
            setTabOrg(data.org); // no longer allowed in it — follow the session
          } finally {
            if (alive) setRestoring(null);
          }
          last = null;
          router.refresh();
          window.dispatchEvent(new Event(TAB_ORG_RESTORED));
          return;
        }
        const now = JSON.stringify(data.v);
        if (scopes && last !== null && now !== last) router.refresh();
        last = now;
      } catch {
        /* offline / server busy — try again next time */
      } finally {
        busy = false;
      }
    };
    check();
    const timer = setInterval(check, INTERVAL_MS);
    const onShow = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [pathname, scopes, router]);

  if (!restoring) return null;
  const name = orgs?.find((o) => o.id === restoring)?.name ?? "this tab's company";
  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="flex items-center gap-2 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg">
        <Spinner /> Switching back to {name}…
      </div>
    </div>
  );
}
