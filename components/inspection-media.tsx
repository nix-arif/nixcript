"use client";

import { useState } from "react";
import { DownloadIcon, LoaderIcon, PlayIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { getInspectionMediaDownload } from "@/server/packing-list";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { InspectionMediaKind } from "@/lib/inspection-media";

// Thumbnail and full view for inspection evidence — a photo, or a video that
// plays in place (see lib/inspection-media.ts).

type Media = { url: string; kind: InspectionMediaKind };

export function InspectionMediaThumb({ media, className }: { media: Media; className?: string }) {
  if (media.kind === "video") {
    return (
      <span className={cn("relative block w-full h-full bg-black", className)}>
        {/* #t=0.1 makes browsers show the first frame instead of a black box */}
        <video src={`${media.url}#t=0.1`} preload="metadata" muted playsInline className="w-full h-full object-cover pointer-events-none" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
          <PlayIcon className="w-3.5 h-3.5 text-white fill-white drop-shadow" />
        </span>
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={media.url} className={cn("w-full h-full object-cover", className)} alt="" />;
}

export function InspectionMediaView({ media }: { media: Media }) {
  if (media.kind === "video") {
    return (
      <video
        key={media.url}
        src={media.url}
        controls
        autoPlay
        playsInline
        className="w-full max-h-[65vh] bg-black"
      >
        Your browser can&apos;t play this video. <a href={media.url} download>Download it</a> instead.
      </video>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={media.url} className="w-full object-contain max-h-[65vh]" alt="" />;
}

/** Saves one photo/video to the user's device (presigned link with a download header). */
export function DownloadMediaButton({ photoId, className }: { photoId: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { url } = await getInspectionMediaDownload(photoId);
          window.location.assign(url);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Couldn't download this file");
        } finally {
          setBusy(false);
        }
      }}
      className={cn("inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 shrink-0", className)}
    >
      {busy ? <LoaderIcon className="w-3 h-3 animate-spin" /> : <DownloadIcon className="w-3 h-3" />}
      Download
    </button>
  );
}

type StripMedia = Media & { id: string; uploadedByName: string | null; amendmentId?: string | null };

// A row of small thumbnails that open in a lightbox with a Download button.
// A photo that came in with an approved change after inspection gets a
// violet ring, so it's clear it wasn't part of the original inspection.
export function InspectionMediaStrip({ photos }: { photos: StripMedia[] }) {
  const [lightbox, setLightbox] = useState<StripMedia | null>(null);
  if (photos.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {photos.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setLightbox(p)}
          className={cn(
            "block w-8 h-8 rounded border overflow-hidden hover:opacity-80 transition-opacity shrink-0",
            p.amendmentId ? "border-violet-500 ring-1 ring-violet-500" : "border-border",
          )}
          title={`${p.kind === "video" ? "Play video" : "View photo"}${p.amendmentId ? " — added after inspection" : ""}`}
        >
          <InspectionMediaThumb media={p} />
        </button>
      ))}
      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0" showCloseButton={false}>
          <DialogTitle className="sr-only">Inspection {lightbox?.kind === "video" ? "video" : "photo"}</DialogTitle>
          {lightbox && (
            <>
              <div className="relative bg-muted/30">
                <InspectionMediaView media={lightbox} />
                <button
                  type="button"
                  onClick={() => setLightbox(null)}
                  className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="px-4 py-3 border-t flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground truncate">
                  {lightbox.uploadedByName ? `Added by ${lightbox.uploadedByName}` : ""}
                  {lightbox.amendmentId ? " · after inspection" : ""}
                </p>
                <DownloadMediaButton photoId={lightbox.id} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
