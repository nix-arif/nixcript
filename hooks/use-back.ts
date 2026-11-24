"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// In-app navigation history for this tab, so a page's Back button can return
// to wherever the user actually came from (e.g. a Sales Order opened from a
// Customer PO's fulfilment trail goes back to the trail, not the SO list).
//
// Mirrors the browser's own history exactly, by recording each pushState /
// replaceState call and each popstate (Back/Forward) — not by guessing from
// paths, which goes wrong for e.g. SO → Edit → Save (a *forward* move back to
// the SO page). Kept in sessionStorage: per tab, survives reloads.

const KEY = "nav-history";
// Set before going back after a delete: Next.js reuses a page's cached copy on
// back navigation, which would still show the deleted document — so the page
// we land on is refreshed from the server once.
const REFRESH_KEY = "nav-refresh-on-arrival";
// A just-deleted document's path and where to go instead: if the user still
// lands on one of its pages (an older history entry), they're sent on.
const DELETED_KEY = "nav-deleted";
const MAX = 50;

type Router = { back: () => void; push: (href: string) => void; replace?: (href: string) => void };

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

// "/dashboard/sales/order/abc?x=1" — path + query, from any URL form.
function here(url?: string | URL | null): string {
  const u = new URL(url ?? window.location.href, window.location.href);
  return u.pathname + u.search;
}
const pathOf = (entry: string) => entry.split("?")[0];
const isUnder = (entry: string, docPath: string) => pathOf(entry) === docPath || pathOf(entry).startsWith(docPath + "/");

/** Mount once in the dashboard layout: records every in-app history change. */
export function useNavHistoryTracker() {
  const pathname = usePathname();
  const router = useRouter();

  // Record history changes as the browser makes them.
  useEffect(() => {
    const stack = read();
    // First run in this tab, or a full page load onto a page we didn't record
    // (a typed URL, a link from outside): it's a new entry. A reload keeps it.
    if (stack[stack.length - 1] !== here()) write([...stack, here()]);

    // Next.js wraps these too (possibly around ours), so on cleanup ours is
    // only removed if it's still the outermost; otherwise it just stops recording.
    let active = true;
    const { pushState, replaceState } = window.history;
    const ourPush: History["pushState"] = function (this: History, data, unused, url) {
      pushState.call(this, data, unused, url);
      if (active && url != null) write([...read(), here(url)]);
    };
    const ourReplace: History["replaceState"] = function (this: History, data, unused, url) {
      replaceState.call(this, data, unused, url);
      if (!active || url == null) return;
      const s = read();
      s[s.length - 1] = here(url);
      write(s);
    };
    window.history.pushState = ourPush;
    window.history.replaceState = ourReplace;
    const onPop = () => {
      // Back (possibly several steps): cut the stack to that entry. Forward,
      // or an entry we can't see: add it.
      const s = read();
      const now = here();
      const i = s.lastIndexOf(now, s.length - 2);
      write(i >= 0 ? s.slice(0, i + 1) : [...s, now]);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      active = false;
      if (window.history.pushState === ourPush) window.history.pushState = pushState;
      if (window.history.replaceState === ourReplace) window.history.replaceState = replaceState;
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // On arriving at a page: refresh it if we came back to it after a delete,
  // or move on if it belongs to the document that was just deleted.
  useEffect(() => {
    try {
      const deleted = JSON.parse(sessionStorage.getItem(DELETED_KEY) ?? "null") as { path: string; fallback: string } | null;
      if (deleted && isUnder(pathname, deleted.path)) {
        router.replace(deleted.fallback);
        return;
      }
      if (sessionStorage.getItem(REFRESH_KEY) === pathname) {
        sessionStorage.removeItem(REFRESH_KEY);
        router.refresh();
      }
    } catch {
      // storage blocked: nothing to do
    }
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
export function navigateBack(router: Router, fallback: string) {
  if (hasInAppHistory()) router.back();
  else router.push(fallback);
}

/**
 * After the current document was deleted: back to the last page before it —
 * skipping every history entry that belongs to it (its edit page too, e.g.
 * SO → Edit → Save → Delete), all of which would now 404 — or to `fallback`
 * when there's no such page. `deletedPath` is the deleted document's own path,
 * e.g. /dashboard/sales/order/<id>.
 */
export function navigateBackAfterDelete(router: Router, fallback: string, deletedPath: string) {
  try {
    sessionStorage.setItem(DELETED_KEY, JSON.stringify({ path: deletedPath, fallback }));
  } catch { /* the safety net in useNavHistoryTracker just won't run */ }

  const stack = read();
  let i = stack.length - 2;
  while (i >= 0 && isUnder(stack[i], deletedPath)) i--;
  if (i >= 0) {
    try { sessionStorage.setItem(REFRESH_KEY, pathOf(stack[i])); } catch { /* see REFRESH_KEY */ }
    window.history.go(-(stack.length - 1 - i));
  } else {
    router.push(fallback);
  }
}
