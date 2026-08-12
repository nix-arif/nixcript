import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getClaimApplicationDetail } from "@/server/claim";
import { getFullOrganizationProfile } from "@/server/organization-profile";
import { getClaimPresignedDownloadUrl } from "@/lib/r2/claim-docs";
import { generateClaimPdf } from "@/app/dashboard/human-resources/claim/generate-claim-pdf";
import { PDFDocument, PDFPage, StandardFonts, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from "pdf-lib";

export const maxDuration = 60;

interface Props {
  params: Promise<{ id: string }>;
}

// A4
const W = 595.28;
const H = 841.89;
const MARGIN = 40;

// Copied verbatim from app/api/quotation/[id]/mda-certs/route.ts — un-rotates a
// copied page so images/PDF receipts scanned sideways render upright.
function normalizePage(page: PDFPage): void {
  const rot = page.getRotation().angle;
  if (rot === 0) return;
  const pw = page.getWidth();
  const ph = page.getHeight();
  let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;
  let newW = pw, newH = ph;
  if (rot === 90) {
    a = 0; b = -1; c = 1; d = 0; e = 0; f = pw;
    newW = ph; newH = pw;
  } else if (rot === 180) {
    a = -1; b = 0; c = 0; d = -1; e = pw; f = ph;
  } else if (rot === 270) {
    a = 0; b = 1; c = -1; d = 0; e = ph; f = 0;
    newW = ph; newH = pw;
  } else {
    return;
  }
  page.node.normalize();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const start = (page as any).createContentStream(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f));
  const startRef = page.doc.context.register(start);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const end = (page as any).createContentStream(popGraphicsState());
  const endRef = page.doc.context.register(end);
  page.node.wrapContentStreams(startRef, endRef);
  page.setSize(newW, newH);
  page.setRotation(degrees(0));
}

export async function GET(_req: Request, { params }: Props) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return new Response("Unauthorized", { status: 401 });

    const { id } = await params;

    let claim;
    try {
      claim = await getClaimApplicationDetail(id);
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
    if (!claim) return new Response("Not Found", { status: 404 });
    if (claim.status === "DRAFT") {
      return new Response("Only submitted claims can be downloaded as PDF", { status: 400 });
    }

    const orgProfile = await getFullOrganizationProfile();
    const formBytes = await generateClaimPdf(claim, orgProfile);

    const merged = await PDFDocument.load(formBytes);

    // Map a lineItemId to a short description, for captioning image receipts
    const itemLabel = new Map<string, string>();
    for (const li of claim.lineItems) itemLabel.set(li.id, li.description || li.category);
    for (const ed of claim.entertainmentDetails) itemLabel.set(ed.id, ed.purpose);

    const skipped: string[] = [];
    let captionFont: Awaited<ReturnType<typeof merged.embedFont>> | null = null;

    for (const doc of claim.documents) {
      try {
        const url = await getClaimPresignedDownloadUrl(doc.fileKey, doc.fileName);
        const res = await fetch(url);
        if (!res.ok) { skipped.push(doc.fileName); continue; }
        const buf = await res.arrayBuffer();

        if (doc.mimeType === "application/pdf") {
          const src = await PDFDocument.load(buf);
          const copied = await merged.copyPages(src, src.getPageIndices());
          copied.forEach((page) => {
            normalizePage(page);
            merged.addPage(page);
          });
        } else if (doc.mimeType === "image/jpeg" || doc.mimeType === "image/png") {
          const img = doc.mimeType === "image/png"
            ? await merged.embedPng(buf)
            : await merged.embedJpg(buf);

          const page = merged.addPage([W, H]);
          if (!captionFont) captionFont = await merged.embedFont(StandardFonts.HelveticaBold);
          const label = doc.lineItemId ? itemLabel.get(doc.lineItemId) : null;
          const caption = label ? `${doc.fileName} — ${label}` : doc.fileName;
          page.drawText(caption, { x: MARGIN, y: H - MARGIN, size: 9, font: captionFont });

          const maxW = W - MARGIN * 2;
          const maxH = H - MARGIN * 2 - 24;
          const scale = Math.min(maxW / img.width, maxH / img.height, 1);
          const iw = img.width * scale;
          const ih = img.height * scale;
          page.drawImage(img, {
            x: (W - iw) / 2,
            y: MARGIN + (maxH - ih) / 2,
            width: iw,
            height: ih,
          });
        } else {
          skipped.push(doc.fileName);
        }
      } catch (err) {
        console.error("[claim pdf] receipt merge failed:", doc.fileName, err);
        skipped.push(doc.fileName);
      }
    }

    if (skipped.length > 0) {
      const page = merged.addPage([W, H]);
      const fontB = await merged.embedFont(StandardFonts.HelveticaBold);
      const fontR = await merged.embedFont(StandardFonts.Helvetica);
      page.drawText("Attachments not included above", { x: MARGIN, y: H - MARGIN, size: 11, font: fontB });
      page.drawText("These files could not be embedded (unsupported format or unavailable) — download them separately from the claim:", {
        x: MARGIN, y: H - MARGIN - 20, size: 8.5, font: fontR,
      });
      skipped.forEach((name, i) => {
        page.drawText(`• ${name}`, { x: MARGIN, y: H - MARGIN - 40 - i * 14, size: 9, font: fontR });
      });
    }

    const bytes = await merged.save();
    const filename = `Claim-${claim.applicationNo}.pdf`;

    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("[claim pdf] unhandled error:", e);
    return new Response("Internal Server Error", { status: 500 });
  }
}
