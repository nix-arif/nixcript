"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DISCARD_URL = "/api/customer-po/upload/discard";

// delete an upload that no CPO uses (the server refuses one that a CPO does); best effort, nothing to wait for
function discard(key: string, leaving = false) {
  const body = JSON.stringify({ key });
  if (leaving && typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(DISCARD_URL, new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch(DISCARD_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}

// The customer's PO document uploaded on the form, before the CPO is saved. It is already in storage (R2), so it is
// deleted again when it stops being needed:
//  - replaced by another file, or removed with X       -> deleted at once
//  - its upload finishes after it was replaced/removed -> deleted instead of attached
//  - the form is left (or the tab closed) unsaved      -> deleted
// Once the CPO is saved with it (markSaved), it is the CPO's document and is left alone.
// A document that was already saved with the CPO before this visit is not handled here: the server deletes it when the
// CPO is saved without it.
export function useUnsavedUpload() {
  const [key, setKey] = useState<string | undefined>();
  const keyRef = useRef<string | undefined>(undefined);
  const seq = useRef(0);        // which upload is the current one
  const saved = useRef(false);  // the CPO was saved with the current key

  const set = (k: string | undefined) => { keyRef.current = k; setKey(k); };

  // a new upload starts: returns its ticket
  const begin = useCallback(() => ++seq.current, []);

  // an upload finished: attach it, unless another file (or none) was chosen meanwhile
  const finish = useCallback((ticket: number, newKey: string): boolean => {
    if (ticket !== seq.current) { discard(newKey); return false; }
    const old = keyRef.current;
    set(newKey);
    saved.current = false;
    if (old && old !== newKey) discard(old);
    return true;
  }, []);

  // X: drop the file (and any upload still running)
  const clear = useCallback(() => {
    seq.current++;
    const old = keyRef.current;
    set(undefined);
    if (old && !saved.current) discard(old);
    saved.current = false;
  }, []);

  // the CPO was saved with this file: it is no longer ours to delete
  const markSaved = useCallback(() => { saved.current = true; }, []);

  // leaving unsaved: in the app (unmount) or by closing the tab
  useEffect(() => {
    const leave = () => { if (keyRef.current && !saved.current) { discard(keyRef.current, true); keyRef.current = undefined; } };
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); leave(); };
  }, []);

  return { key, begin, finish, clear, markSaved };
}
