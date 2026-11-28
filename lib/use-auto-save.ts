"use client";

// Auto-save for a document form (SO, PR, PO drafts). The form passes what it would save: the hook
// saves it a short while after the user stops changing it, one save at a time, and again if it
// changed while saving. It also saves straight away when the tab is hidden or closed.
//
// `value` is the save input, or null while the form can't be saved yet (nothing linked, no lines…).
// On an edit form (loadedSaved) the first value seen counts as already saved: it's what the page
// loaded, so opening it never saves by itself. A create form saves its first value too.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export function useAutoSave<T>({
  value,
  enabled,
  save,
  delay = 2500,
  loadedSaved = true,
}: {
  value: T | null;
  enabled: boolean;
  save: (value: T) => Promise<void>;
  delay?: number;
  /** true (edit form): what the page loaded is already saved. false (create form): nothing is. */
  loadedSaved?: boolean;
}) {
  const key = value === null ? null : JSON.stringify(value);
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  // the key last saved (or loaded); undefined: nothing seen yet
  const [savedKey, setSavedKeyState] = useState<string | null | undefined>(loadedSaved ? undefined : null);

  const latest = useRef<{ key: string | null; value: T | null }>({ key: null, value: null });
  const savedKeyRef = useRef<string | null | undefined>(savedKey);
  const running = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  const enabledRef = useRef(enabled);
  const stoppedRef = useRef(false); // the document is being thrown away: save nothing more

  const setSavedKey = useCallback((k: string | null) => {
    savedKeyRef.current = k;
    setSavedKeyState(k);
  }, []);

  useLayoutEffect(() => {
    latest.current = { key, value };
    saveRef.current = save;
    enabledRef.current = enabled;
    // an edit form: the first value is what the page loaded, nothing to save
    if (savedKeyRef.current === undefined && key !== null) setSavedKey(key);
  });

  const run = useCallback(async (): Promise<void> => {
    // one save at a time: wait for the one in flight, then save what's newest
    while (running.current) await running.current;
    const { key: k, value: v } = latest.current;
    if (stoppedRef.current || !enabledRef.current || k === null || v === null || k === savedKeyRef.current) return;
    setStatus("saving");
    const p = (async () => {
      try {
        await saveRef.current(v);
        setSavedKey(k);
        setSavedAt(new Date());
        setError(null);
        setStatus("saved");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
        setStatus("error");
      }
    })();
    running.current = p;
    await p;
    running.current = null;
  }, [setSavedKey]);

  // a change (or a newer version after a save): save it once the user pauses
  useEffect(() => {
    if (!enabled || key === null || savedKey === undefined || key === savedKey) return;
    const t = setTimeout(() => void run(), delay);
    timer.current = t;
    return () => clearTimeout(t);
  }, [key, savedKey, enabled, delay, run]);

  // leaving the tab or closing it: save now rather than lose the last few seconds
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") void run(); };
    const onHide = () => void run();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      void run(); // leaving the form for another page of the app
    };
  }, [run]);

  /** Save any change not saved yet, and wait for it (before Submit, leaving the page…). */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await run();
  }, [run]);

  /** Treat what the form shows now as saved (after the page saved it itself). */
  const markSaved = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSavedKey(latest.current.key);
    setSavedAt(new Date());
    setStatus("saved");
  }, [setSavedKey]);

  /**
   * Before cancelling or deleting the document: no more saves (not on leaving the page either), and
   * wait for one already in flight, so it can't land after the delete. resume() undoes it.
   */
  const stop = useCallback(async () => {
    stoppedRef.current = true;
    if (timer.current) clearTimeout(timer.current);
    while (running.current) await running.current;
  }, []);

  /** The cancel or delete didn't happen: save again, starting with anything changed meanwhile. */
  const resume = useCallback(() => {
    stoppedRef.current = false;
    void run();
  }, [run]);

  const dirty = key !== null && savedKey !== undefined && key !== savedKey;
  return { status, savedAt, error, dirty, flush, markSaved, stop, resume };
}

/** True once the user has clicked or typed on the page: a create form saves a draft only after that. */
export function useUserInteracted(): boolean {
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    const on = () => setTouched(true);
    window.addEventListener("pointerdown", on, { capture: true });
    window.addEventListener("keydown", on, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", on, { capture: true });
      window.removeEventListener("keydown", on, { capture: true });
    };
  }, [touched]);
  return touched;
}
