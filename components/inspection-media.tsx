"use client";

import { useState } from "react";
import { DownloadIcon, LoaderIcon, PlayIcon } from "lucide-react";
import { toast } from "sonner";
import { getInspectionMediaDownload } from "@/server/packing-list";
import { cn } from "@/lib/utils";
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
