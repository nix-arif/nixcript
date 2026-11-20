"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { addIssueMedia, deleteIssueMedia, getIssueMediaUploadUrl } from "@/server/post-delivery";
import { Button } from "@/components/ui/button";
import { ImagePlusIcon, Loader2Icon, TrashIcon } from "lucide-react";

// Uploads files straight to storage with a signed link, then records them on the issue
export async function uploadIssueFiles(issueId: string, files: File[], itemId?: string | null): Promise<{ done: number; failed: string[] }> {
  let done = 0;
  const failed: string[] = [];
  for (const file of files) {
    try {
      const up = await getIssueMediaUploadUrl(issueId, file.name, file.type, file.size);
      if (!up.ok) { failed.push(`${file.name}: ${up.error}`); continue; }
      const put = await fetch(up.value.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      if (!put.ok) { failed.push(`${file.name}: the upload did not go through`); continue; }
      const rec = await addIssueMedia(issueId, { key: up.value.key, filename: file.name, kind: up.value.kind, itemId });
      if (!rec.ok) { failed.push(`${file.name}: ${rec.error}`); continue; }
      done++;
    } catch (e) { failed.push(`${file.name}: ${e instanceof Error ? e.message : "failed"}`); }
  }
  return { done, failed };
}

export type MediaView = { id: string; kind: string; filename: string; caption: string | null; url: string | null; itemId?: string | null; uploadedByName?: string | null };

export function EvidenceUploader({ issueId, itemId, onDone, label = "Add photos or videos" }: { issueId: string; itemId?: string | null; onDone: () => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(list: FileList | null) {
    const files = list ? [...list] : [];
    if (files.length === 0) return;
    setBusy(true);
    const r = await uploadIssueFiles(issueId, files, itemId);
    setBusy(false);
    if (ref.current) ref.current.value = "";
    if (r.done > 0) toast.success(`${r.done} file${r.done === 1 ? "" : "s"} added`);
    for (const f of r.failed) toast.error(f, { duration: 8000 });
    if (r.done > 0) onDone();
  }
  return (
    <>
      <input ref={ref} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => void pick(e.target.files)} />
      <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <ImagePlusIcon className="h-3.5 w-3.5" />}{busy ? "Uploading…" : label}
      </Button>
    </>
  );
}

export function EvidenceGallery({ media, canEdit, onChanged, itemName }: { media: MediaView[]; canEdit: boolean; onChanged: () => void; itemName?: (itemId: string | null | undefined) => string | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (media.length === 0) return <p className="text-xs text-muted-foreground">No photos or videos yet.</p>;
  async function remove(m: MediaView) {
    if (!confirm(`Remove ${m.filename}?`)) return;
    setBusy(m.id);
    const r = await deleteIssueMedia(m.id);
    setBusy(null);
    if (!r.ok) toast.error(r.error); else { toast.success("Removed"); onChanged(); }
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {media.map((m) => (
        <li key={m.id} className="group relative overflow-hidden rounded-lg border border-border bg-muted/20">
          {m.url ? (
            m.kind === "video"
              ? <video src={m.url} controls preload="metadata" className="aspect-video w-full bg-black object-contain" />
              : <a href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt={m.filename} loading="lazy" className="aspect-4/3 w-full object-cover" /></a>
          ) : <div className="flex aspect-4/3 items-center justify-center text-[11px] text-muted-foreground">Not available</div>}
          <div className="px-2 py-1.5 text-[11px]">
            <div className="truncate" title={m.filename}>{m.caption || m.filename}</div>
            {itemName && m.itemId && <div className="truncate text-muted-foreground">{itemName(m.itemId)}</div>}
          </div>
          {canEdit && (
            <button type="button" aria-label={`Remove ${m.filename}`} disabled={busy === m.id} onClick={() => void remove(m)}
              className="absolute right-1.5 top-1.5 rounded-md bg-background/90 p-1 text-muted-foreground opacity-0 shadow transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100">
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
