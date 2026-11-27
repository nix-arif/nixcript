"use client";

// A document's amendments (Rev 1, Rev 2…): when, by whom, why and what changed.
// Shown on the customer PO, sales order and supplier PO pages; nothing when it was never amended.
// "View versions" opens every version, to compare and print (document-versions-dialog.tsx).

import { useEffect, useState } from "react";
import { FilePenLineIcon, HistoryIcon } from "lucide-react";
import { DocumentVersionsDialog } from "@/components/document-versions-dialog";
import { getDocumentAmendments, getDocumentRevisions } from "@/server/amendment";
import type { AmendmentRecord, DocType } from "@/lib/amendment/customer-po";

export function AmendmentHistory({
  docType,
  docId,
  onRevision,
}: {
  docType: DocType;
  docId: string;
  /** The document's current revision once loaded (0: never amended) */
  onRevision?: (revision: number) => void;
}) {
  const [rows, setRows] = useState<AmendmentRecord[] | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  useEffect(() => {
    let live = true;
    getDocumentAmendments(docType, docId)
      .then((r) => { if (!live) return; setRows(r); onRevision?.(r[0]?.revision ?? 0); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
    // onRevision is a callback from the page: loading once per document is enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType, docId]);

  if (!rows || rows.length === 0) return null;
  return (
    <section className="border border-border rounded-xl p-4 space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <FilePenLineIcon className="h-4 w-4 text-amber-600" /> Amendments
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Rev {rows[0].revision}</span>
        <button type="button" onClick={() => setVersionsOpen(true)}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted">
          <HistoryIcon className="h-3.5 w-3.5" /> View versions
        </button>
      </h2>
      <DocumentVersionsDialog docType={docType} docId={docId} open={versionsOpen} onOpenChange={setVersionsOpen} />
      <ol className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="text-xs">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">Rev {r.revision}</span>
              <span className="text-muted-foreground">
                {new Date(r.createdAt).toLocaleString("en-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                {r.createdByName ? ` · ${r.createdByName}` : ""}
              </span>
            </div>
            <p className="mt-0.5">{r.reason}</p>
            {r.summary.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {r.summary.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The current revision of each document in a list (loaded once per set of ids): { id: revision }. */
export function useRevisions(docType: DocType, ids: string[]): Record<string, number> {
  const [revs, setRevs] = useState<Record<string, number>>({});
  const key = ids.join(",");
  useEffect(() => {
    let live = true;
    if (key) getDocumentRevisions(docType, key.split(",")).then((r) => { if (live) setRevs(r); }).catch(() => {});
    return () => { live = false; };
  }, [docType, key]);
  return revs;
}

/** "Rev 1" next to a document number in a list, when it was amended. */
export function RevBadge({ revision }: { revision?: number }) {
  if (!revision) return null;
  return (
    <span title={`Amended: revision ${revision}`}
      className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
      Rev {revision}
    </span>
  );
}

// Rev badges that look themselves up: every badge on the page asks in one go, per kind of document
const revQueue: Record<DocType, Map<string, ((rev: number) => void)[]>> = { cpo: new Map(), so: new Map(), po: new Map() };
const revTimer: Partial<Record<DocType, ReturnType<typeof setTimeout>>> = {};
function loadRevision(docType: DocType, docId: string): Promise<number> {
  return new Promise((resolve) => {
    const q = revQueue[docType];
    q.set(docId, [...(q.get(docId) ?? []), resolve]);
    if (revTimer[docType]) return;
    revTimer[docType] = setTimeout(() => {
      delete revTimer[docType];
      const batch = revQueue[docType];
      revQueue[docType] = new Map();
      getDocumentRevisions(docType, [...batch.keys()])
        .then((r) => batch.forEach((cbs, id) => cbs.forEach((cb) => cb(r[id] ?? 0))))
        .catch(() => batch.forEach((cbs) => cbs.forEach((cb) => cb(0))));
    }, 0);
  });
}

/** "Rev N" for one document, looked up by itself (nothing when it was never amended). */
export function DocRevBadge({ docType, docId }: { docType: DocType; docId: string | null | undefined }) {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (!docId) return;
    let live = true;
    loadRevision(docType, docId).then((r) => { if (live) setRev(r); });
    return () => { live = false; };
  }, [docType, docId]);
  return <RevBadge revision={rev} />;
}

/** A document's amendments as history events (for the hover history cards). */
export async function amendmentEvents(docType: DocType, docId: string, label?: string) {
  const rows = await getDocumentAmendments(docType, docId).catch(() => [] as AmendmentRecord[]);
  return rows.map((r) => ({
    at: new Date(r.createdAt),
    title: `${label ? `${label} ` : ""}amended — Rev ${r.revision}`,
    detail: [r.reason, r.createdByName && `by ${r.createdByName}`, ...r.summary.slice(0, 3)].filter(Boolean).join(" · "),
  }));
}
