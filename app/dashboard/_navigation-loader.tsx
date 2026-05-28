"use client";

/**
 * NavigationLoader — shows the dashboard skeleton on every internal navigation.
 *
 * Why this is needed:
 * Next.js 16 uses React startTransition for all client-side navigations.
 * startTransition keeps the OLD page visible while the new page loads, which
 * means loading.tsx Suspense fallbacks never fire on repeated navigations.
 * loading.tsx only works when the skeleton has been prefetched ahead of time —
 * which only happens in production, not in development mode.
 *
 * This component:
 *   1. Captures the click at the document level (capture phase, before React)
 *   2. Immediately swaps in the skeleton — no waiting on startTransition
 *   3. Resets when usePathname() reports the new route (navigation committed)
 *   4. Resets on a 10s safety timeout to recover from failed navigations
 */

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DashboardLoadingSkeleton } from "./_loading-skeleton";
import { useAppStore } from "@/lib/store/use-app-store";

export function NavigationLoader({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const prevPathname = useRef(pathname);
  const [isLoading, setIsLoading] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSwitchingOrg = useAppStore((s) => s.isSwitchingOrg);
  // Track whether the current loading state was triggered by an org switch
  const isOrgSwitchLoading = useRef(false);

  // Org switch: show skeleton on start, clear on completion
  // isSwitchingOrg goes true  → show skeleton
  // isSwitchingOrg goes false → clear (org switcher calls setOrgSwitching(false) when done)
  useEffect(() => {
    if (isSwitchingOrg) {
      isOrgSwitchLoading.current = true;
      setIsLoading(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        isOrgSwitchLoading.current = false;
        setIsLoading(false);
      }, 10_000);
    } else if (isOrgSwitchLoading.current) {
      // org switch completed — clear skeleton
      isOrgSwitchLoading.current = false;
      setIsLoading(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [isSwitchingOrg]);

  // Clear loading when pathname actually changes (regular nav committed)
  useEffect(() => {
    if (pathname !== prevPathname.current) {
      prevPathname.current = pathname;
      setIsLoading(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [pathname]);

  // Intercept every click on an internal <a> element
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      // Skip: no href, external links, hash-only, mailto, or same page
      if (!href) return;
      if (href.startsWith("http") || href.startsWith("//")) return;
      if (href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (href.startsWith("#")) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey) return; // open-in-new-tab
      if (anchor.target === "_blank") return;

      // Strip query/hash to compare pathname only
      const destPathname = href.split("?")[0].split("#")[0];
      if (!destPathname || destPathname === prevPathname.current) return;

      setIsLoading(true);

      // Safety reset — if navigation never commits (error, network)
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setIsLoading(false), 10_000);
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []); // stable — prevPathname is a ref, no deps needed

  if (isLoading) {
    return <DashboardLoadingSkeleton />;
  }

  return <>{children}</>;
}
