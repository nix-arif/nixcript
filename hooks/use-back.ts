"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// In-app navigation history for this tab, so a page's Back button can return
// to wherever the user actually came from (e.g. a Sales Order opened from a
// Customer PO's fulfilment trail goes back to the trail, not the SO list).
//
// Kept in sessionStorage: survives reloads, is per tab, and is gone when the
// tab closes. Moving to the path just before the current one is treated as
// going back (covers the browser's own Back button too); anything else as
// going forward.

const KEY = "nav-history";
const MAX = 50;

function read(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(stack: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX)));
  } catch {
    // storage full or blocked: Back falls back to each page's default
  }
}

/** Mount once in the dashboard layout: records every in-app page change. */
export function useNavHistoryTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const stack = read();
    const last = stack[stack.length - 1];
    if (last === pathname) return; // reload, or a re-render on the same page
    if (stack[stack.length - 2] === pathname) stack.pop(); // went back
    else stack.push(pathname);
    write(stack);
  }, [pathname]);
}

/**
 * The Back action for a page: back to the previous in-app page when there is
 * one, otherwise to `fallback` (the page was opened directly — new tab,
 * bookmark, link from outside — so there's nothing of ours to go back to).
 */
export function useBack(fallback: string) {
  const router = useRouter();
  return useCallback(() => navigateBack(router, fallback), [router, fallback]);
}

/** True when there's an earlier in-app page in this tab to go back to. */
export function hasInAppHistory(): boolean {
  return read().length > 1;
}

/** Same as useBack, for handlers that already have the router in hand. */
export function navigateBack(router: { back: () => void; push: (href: string) => void }, fallback: string) {
  if (hasInAppHistory()) router.back();
  else router.push(fallback);
}
