"use client";

// On a list a deleted document's page sent the user back to (?gone=1): says so once, then tidies the
// address so a refresh doesn't say it again.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

export function GoneNotice({ what }: { what: string }) {
  const gone = useSearchParams().get("gone");
  useEffect(() => {
    if (gone !== "1") return;
    toast.info(`That ${what} no longer exists (it was deleted). Here is the list instead.`, { duration: 6000 });
    const url = new URL(window.location.href);
    url.searchParams.delete("gone");
    window.history.replaceState(null, "", url);
  }, [gone, what]);
  return null;
}
