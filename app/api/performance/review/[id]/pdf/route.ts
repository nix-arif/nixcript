import { getCachedSession } from "@/lib/auth/cached-session";
import { getReviewView } from "@/server/performance";
import { loadLetterhead } from "@/lib/pdf/letterhead";
import { generateReviewPdf } from "@/lib/performance/review-pdf";

export const maxDuration = 60;

// A performance review as a PDF on the letterhead of the company the review is kept under (the employee's own).
// Anyone who can open the review can download it, and it shows exactly what they see on screen: getReviewView
// applies the same rules (who is on the review, and what each side may see at its status).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCachedSession();
    if (!session) return new Response("Unauthorized", { status: 401 });
    if (!session.session.activeOrganizationId) return new Response("No active organization", { status: 400 });

    const { id } = await params;
    const view = await getReviewView(id);
    if (!view) return new Response("Review not found, or you can't see it.", { status: 404 });

    const letterhead = await loadLetterhead(view.organizationId);
    const bytes = await generateReviewPdf(view, letterhead);

    const filename = reviewPdfName(view.employeeName, view.periodName);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store", // a review is personal: never kept by a shared cache
      },
    });
  } catch (e) {
    console.error("[review pdf] unhandled error:", e);
    return new Response("The PDF could not be made. Please try again.", { status: 500 });
  }
}

// "Performance-Review-Siti-Aminah-2026-H2.pdf": letters, digits and dashes only, so it is a safe header value
function reviewPdfName(employee: string, period: string): string {
  const part = (s: string) => s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);
  return ["Performance-Review", part(employee), part(period)].filter(Boolean).join("-") + ".pdf";
}
