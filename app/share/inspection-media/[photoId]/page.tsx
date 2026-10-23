import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSharedInspectionMedia } from "@/lib/inspection-media-share";

// Public, login-free page the discrepancy report links to: plays one inspection
// video (or shows one photo) in the browser. Opens only with the signed `s`
// link printed in the report — see lib/inspection-media-share.ts.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Inspection evidence",
  robots: { index: false, follow: false },
};

export default async function SharedInspectionMediaPage({
  params,
  searchParams,
}: {
  params: Promise<{ photoId: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const { photoId } = await params;
  const { s } = await searchParams;
  const media = await getSharedInspectionMedia(photoId, s);
  if (!media) notFound();

  return (
    <main className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-background border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-border">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {media.companyName ? `${media.companyName} · ` : ""}Packing list {media.packingListNo}
          </p>
          <h1 className="text-sm font-semibold">
            {media.categoryLabel} — line {media.lineNo} ({media.kind === "video" ? "video" : "photo"})
          </h1>
        </div>

        <div className="bg-black flex items-center justify-center">
          {media.kind === "video" ? (
            <video src={media.url} controls playsInline preload="metadata" className="w-full max-h-[75vh]">
              Your browser can&apos;t play this video — use the download link below.
            </video>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media.url} alt={media.filename} className="max-w-full max-h-[75vh] object-contain" />
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground truncate">{media.filename}</span>
          <a href={media.downloadUrl} className="text-blue-600 hover:underline shrink-0">
            Download
          </a>
        </div>
      </div>
    </main>
  );
}
