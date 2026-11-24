"use client";

import { useNavHistoryTracker } from "@/hooks/use-back";

// Records in-app page changes so Back buttons (useBack) return to the page the
// user actually came from. Renders nothing.
export function NavHistoryTracker() {
  useNavHistoryTracker();
  return null;
}
