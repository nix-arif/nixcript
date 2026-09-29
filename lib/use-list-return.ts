"use client";

/**
 * useListReturn — "come back to the list where I left it".
 *
 * For list pages whose rows open a detail page: when the user returns with
 * back/forward (browser button, swipe, or router.back()), restore the scroll
 * position they left at; a fresh visit (sidebar link) starts at the top.
 *
 * Why this needs care (all learned on the quotation list):
 *  - Detecting a *return*: the list's own history entry is marked in
 *    history.state (next to Next's internal state). Returning to that entry
 *    finds the mark — works in every browser, including iOS Safari without the
 *    Navigation API. Chromium can re-render the restored page from the
 *    Navigation API "navigate" event *before* the URL/history.state switch, so
 *    a recent traverse-to-this-path signal is also accepted in that window.
 *  - Saving the scroll: from a layout-effect cleanup (and `beforeLeave()` for
 *    programmatic navigation) — before Next scrolls the next page to the top.
 *  - Restoring it: the browser's own restoration runs against the shorter
 *    detail page and clamps to ~0, and Safari re-applies its recorded offset
 *    after render. So restoration is switched to "manual" while returning,
 *    and the position is held for ~1s against late layout shifts (stopping
 *    as soon as the user touches/scrolls).
 *
 * Usage:
 *   const { isReturn, beforeLeave } = useListReturn("do-list", "/dashboard/fulfillment/delivery");
 *   // call beforeLeave() right before router.push(...) to a detail page
 */

import { useEffect, useLayoutEffect, useState } from "react";

const HISTORY_MARK_PREFIX = "__listReturn:";
const TRAVERSAL_WINDOW_MS = 15_000;
const HOLD_MS = 1000;

// ── Module-level state (shared by every list using the hook) ────────────────
const mountedKeys = new Set<string>();           // lists shown at least once in this document
const pendingTraversal = new Map<string, number>(); // pathname → time of a back/forward to it

if (typeof window !== "undefined") {
  const note = (url: string) => {
    try { pendingTraversal.set(new URL(url, window.location.href).pathname, Date.now()); } catch {}
  };
  (window as unknown as {
    navigation?: { addEventListener: (t: "navigate", cb: (e: { navigationType: string; destination: { url: string } }) => void) => void };
  }).navigation?.addEventListener("navigate", (e) => {
    if (e.navigationType === "traverse") note(e.destination.url);
  });
  window.addEventListener("popstate", () => note(window.location.href));
}

function markFor(key: string) {
  return HISTORY_MARK_PREFIX + key;
}

function detectReturn(key: string, listPath: string): boolean {
  if (typeof window === "undefined" || !mountedKeys.has(key)) return false;
  if (window.location.pathname === listPath) {
    // Current entry is a list entry: its mark is authoritative (absent = new visit)
    const st = window.history.state as Record<string, unknown> | null;
    return st?.[markFor(key)] === true;
  }
  // URL not switched yet (Chromium early restore): accept a recent traversal here
  const at = pendingTraversal.get(listPath) ?? 0;
  return Date.now() - at < TRAVERSAL_WINDOW_MS;
}

function markEntry(key: string, listPath: string) {
  try {
    if (window.location.pathname !== listPath) return;
    const st = (window.history.state ?? {}) as Record<string, unknown>;
    if (st[markFor(key)] === true) return;
    // Keep Next's state; no URL argument, so Next's stored tree stays in sync
    window.history.replaceState({ ...st, [markFor(key)]: true }, "");
  } catch {}
}

function saveScroll(key: string) {
  try { sessionStorage.setItem(`${key}:scroll`, String(Math.round(window.scrollY))); } catch {}
}

export function useListReturn(key: string, listPath: string, routeKey?: string) {
  // Decided once per mount
  const [isReturn] = useState(() => detectReturn(key, listPath));

  useLayoutEffect(() => {
    mountedKeys.add(key);
    pendingTraversal.delete(listPath);
    markEntry(key, listPath);

    let stopHolding = () => {};
    if (isReturn) {
      let y = 0;
      try { y = Number(sessionStorage.getItem(`${key}:scroll`)) || 0; } catch {}
      if (y > 0) {
        window.scrollTo(0, y);
        let raf = 0;
        const until = performance.now() + HOLD_MS;
        const hold = () => {
          if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
          raf = performance.now() < until ? requestAnimationFrame(hold) : 0;
        };
        raf = requestAnimationFrame(hold);
        const userEvents = ["touchstart", "wheel", "keydown", "mousedown"] as const;
        stopHolding = () => {
          cancelAnimationFrame(raf);
          userEvents.forEach((ev) => window.removeEventListener(ev, stopHolding));
        };
        userEvents.forEach((ev) => window.addEventListener(ev, stopHolding, { passive: true }));
      }
    }
    // Back to "auto" only once the return has settled (popstate / Safari's
    // own restore can land after this effect)
    const autoTimer = setTimeout(() => {
      try { window.history.scrollRestoration = "auto"; } catch {}
    }, 1500);

    return () => {
      clearTimeout(autoTimer);
      stopHolding();
      saveScroll(key);
      try { window.history.scrollRestoration = "manual"; } catch {}
      markEntry(key, listPath);
    };
  }, [key, listPath, isReturn]);

  // router.replace/push within the list (search, filters, paging) rewrites the
  // entry's state without our mark — re-apply it after each such change.
  useEffect(() => {
    const t = setTimeout(() => markEntry(key, listPath), 0);
    return () => clearTimeout(t);
  }, [key, listPath, routeKey]);

  return {
    isReturn,
    /** Call right before navigating away programmatically (router.push). */
    beforeLeave: () => {
      saveScroll(key);
      markEntry(key, listPath);
      try { window.history.scrollRestoration = "manual"; } catch {}
    },
  };
}

// ── Detail-page side: "Back" should return to the list the user came from ───

const OPENED_FROM_LIST = "listReturn:openedFrom";   // one-shot: consumed by the detail page
const LAST_LIST_URL = "listReturn:lastListUrl:";     // persistent per list: URL incl. filters

/** List side: record that the user is opening `detailPath` from this list. */
export function noteOpenedFromList(key: string, detailPath: string) {
  try {
    const listUrl = window.location.pathname + window.location.search;
    sessionStorage.setItem(OPENED_FROM_LIST, JSON.stringify({ detailPath, at: Date.now() }));
    sessionStorage.setItem(LAST_LIST_URL + key, listUrl);
  } catch {}
}

/**
 * Detail side. `fromList` is true when this page was opened straight from the
 * list — Back should then be router.back(), restoring the cached list with its
 * filters and scroll. Otherwise (opened directly, or reached again after an
 * edit pushed a new entry) Back should navigate to `listUrl` — the list URL
 * last used, filters included — or the bare list when there is none.
 *
 * Read without side effects during render (StrictMode double-invokes
 * initialisers); the one-shot flag is consumed in an effect, so a later visit
 * to this same detail page can't router.back() into, say, the editor.
 */
export function useOpenedFromList(key: string, detailPath: string, fallbackListPath: string) {
  const [info] = useState(() => {
    if (typeof window === "undefined") return { fromList: false, listUrl: fallbackListPath };
    let fromList = false;
    let listUrl = fallbackListPath;
    try {
      const raw = sessionStorage.getItem(OPENED_FROM_LIST);
      if (raw) {
        const v = JSON.parse(raw) as { detailPath: string; at: number };
        fromList = v.detailPath === detailPath && Date.now() - v.at < 60 * 60 * 1000;
      }
      listUrl = sessionStorage.getItem(LAST_LIST_URL + key) || fallbackListPath;
    } catch {}
    return { fromList, listUrl };
  });
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(OPENED_FROM_LIST);
      if (raw && (JSON.parse(raw) as { detailPath: string }).detailPath === detailPath) {
        sessionStorage.removeItem(OPENED_FROM_LIST);
      }
    } catch {}
  }, [detailPath]);
  return info;
}
