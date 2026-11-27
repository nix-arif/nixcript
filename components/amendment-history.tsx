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
