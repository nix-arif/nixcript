"use client";

import { PlayIcon } from "lucide-react";
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
