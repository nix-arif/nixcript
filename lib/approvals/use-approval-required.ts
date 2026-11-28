"use client";

// Whether the active company needs this document approved (Approvals page), for a form's Submit
// button: "Submit for approval", or Confirm / Submit when it doesn't. Until it's known: approval.

import { useEffect, useState } from "react";
import { approvalRequiredFor } from "@/server/approval-settings";

const cache = new Map<string, Promise<boolean>>();

export function useApprovalRequired(permissionKey: string): boolean {
  const [required, setRequired] = useState(true);
  useEffect(() => {
    let live = true;
    if (!cache.has(permissionKey)) cache.set(permissionKey, approvalRequiredFor(permissionKey).catch(() => true));
    cache.get(permissionKey)!.then((r) => { if (live) setRequired(r); });
    return () => { live = false; };
  }, [permissionKey]);
  return required;
}
