import { getInspectionMediaDownload } from "@/server/packing-list";

interface Props {
  params: Promise<{ photoId: string }>;
}

// The target of the video/photo links printed in the discrepancy report PDF:
// checks the signed-in user's access to the packing list, then redirects to a
// fresh, short-lived download link (so the link in a saved PDF keeps working).
export async function GET(_req: Request, { params }: Props) {
  const { photoId } = await params;
  try {
    const { url } = await getInspectionMediaDownload(photoId);
    return Response.redirect(url, 302);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Couldn't open this file";
    const status = msg.includes("sign") ? 401 : msg.includes("permission") ? 403 : msg.includes("not found") ? 404 : 500;
    return new Response(
      status === 401 ? "Please sign in to the system first, then open this link again." : msg,
      { status },
    );
  }
}
