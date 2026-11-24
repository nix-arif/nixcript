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
// Set before going back after a delete: Next.js reuses a page's cached copy on
// back navigation, which would still show the deleted document — so the page
// we land on is refreshed from the server once (see useNavHistoryTracker).
const REFRESH_KEY = "nav-refresh-on-arrival";
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
  const router = useRouter();
  useEffect(() => {
    try {
      const target = sessionStorage.getItem(REFRESH_KEY);
      if (target === pathname) {
        sessionStorage.removeItem(REFRESH_KEY);
        router.refresh();
      }
    } catch {
      // storage blocked: the page just shows its cached copy until reloaded
    }
    const stack = read();
    const last = stack[stack.length - 1];
    if (last === pathname) return; // reload, or a re-render on the same page
    if (stack[stack.length - 2] === pathname) stack.pop(); // went back
    else stack.push(pathname);
    write(stack);
  }, [pathname, router]);
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

/**
 * Back, after the current document was deleted: to the previous page — unless
 * that page also belongs to the deleted document (its edit page, say, which
 * would now 404), or there's no previous in-app page; then to `fallback`.
 * `deletedPath` is the deleted document's own path, e.g. /dashboard/sales/order/<id>.
 */
export function navigateBackAfterDelete(router: { back: () => void; push: (href: string) => void }, fallback: string, deletedPath: string) {
  const stack = read();
  const previous = stack[stack.length - 2];
  if (previous && previous !== deletedPath && !previous.startsWith(deletedPath + "/")) {
    try { sessionStorage.setItem(REFRESH_KEY, previous); } catch { /* see REFRESH_KEY */ }
    router.back();
  } else {
    router.push(fallback);
  }
}
