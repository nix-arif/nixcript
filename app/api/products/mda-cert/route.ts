import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { member, product } from "@/db/schema";
import { and, eq, inArray, asc } from "drizzle-orm";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";

export const maxDuration = 60;

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

async function presignMdaKey(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: process.env.R2_MDA_CERTIFICATES_BUCKET!, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

async function getOwnerOrgId(userId: string, currentOrgId: string): Promise<string> {
  const [ownerMember] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, currentOrgId), eq(member.role, "owner")))
    .limit(1);
  if (!ownerMember) return currentOrgId;
  const [primaryOrg] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, ownerMember.userId), eq(member.role, "owner")))
    .orderBy(asc(member.createdAt))
    .limit(1);
  return primaryOrg?.organizationId ?? currentOrgId;
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const orgId = session.session.activeOrganizationId;
  if (!orgId) return new Response("No active organization", { status: 400 });

  const perms = await getUserPermissions(session.user.id, orgId);
  if (!hasAccess(perms, "product:read")) return new Response("Forbidden", { status: 403 });

  const { rows }: { rows: Array<{ no: number; productCode: string }> } = await req.json();
  if (!rows?.length) return new Response("No rows provided", { status: 400 });

  const ownerOrgId = await getOwnerOrgId(session.user.id, orgId);
  const codes = [...new Set(rows.map((r) => r.productCode).filter(Boolean))];

  const pRows = await db
    .select({
      productCode: product.productCode,
      mdaPdfFile: product.mdaPdfFile,
      mdaPageNo: product.mdaPageNo,
      mdaMatchX: product.mdaMatchX,
      mdaMatchY: product.mdaMatchY,
      mdaRowHeight: product.mdaRowHeight,
      mdaPageWidth: product.mdaPageWidth,
      mdaPageHeight: product.mdaPageHeight,
    })
    .from(product)
    .where(and(eq(product.organizationId, ownerOrgId), inArray(product.productCode, codes)));

  const pMap = new Map(pRows.map((r) => [r.productCode, r]));

  const uniqueKeys = [...new Set(pRows.map((r) => r.mdaPdfFile).filter(Boolean) as string[])];
  const presignMap = new Map<string, string>();
  await Promise.all(
    uniqueKeys.map(async (key) => {
      const url = await presignMdaKey(key);
      presignMap.set(key, url);
    }),
  );

  type EnrichedItem = {
    no: number;
    productCode: string;
    mdaPdfFile: string;
    mdaPdfUrl: string;
    mdaPageNo: string | null;
    mdaMatchX: string | null;
    mdaMatchY: string | null;
    mdaRowHeight: string | null;
    mdaPageWidth: string | null;
    mdaPageHeight: string | null;
  };

  const enrichedItems: EnrichedItem[] = [];
  for (const row of rows) {
    const p = pMap.get(row.productCode);
    if (!p?.mdaPdfFile) continue;
    const url = presignMap.get(p.mdaPdfFile);
    if (!url) continue;
    enrichedItems.push({
      no: row.no,
      productCode: row.productCode,
      mdaPdfFile: p.mdaPdfFile,
      mdaPdfUrl: url,
      mdaPageNo: p.mdaPageNo,
      mdaMatchX: p.mdaMatchX,
      mdaMatchY: p.mdaMatchY,
      mdaRowHeight: p.mdaRowHeight,
      mdaPageWidth: p.mdaPageWidth,
      mdaPageHeight: p.mdaPageHeight,
    });
  }

  if (enrichedItems.length === 0) {
    return new Response("No MDA certificates found for the provided product codes", { status: 404 });
  }

  // Group by PDF file key — same PDF fetched once even if multiple rows use it
  const mdaGroups = new Map<string, { url: string; items: EnrichedItem[] }>();
  for (const item of enrichedItems) {
    const g = mdaGroups.get(item.mdaPdfFile) ?? { url: item.mdaPdfUrl, items: [] };
    g.items.push(item);
    mdaGroups.set(item.mdaPdfFile, g);
  }

  const mergedPdf = await PDFDocument.create();
  const font = await mergedPdf.embedFont(StandardFonts.HelveticaBold);

  for (const [, g] of mdaGroups) {
    try {
      const res = await fetch(g.url);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const srcPdf = await PDFDocument.load(buf);
      const total = srcPdf.getPageCount();

      const pageSet = new Set<number>([0, 1].filter((i) => i < total));
      // Key: "pageIdx:y" — merges duplicate-product rows into one highlight with combined nos
      const hlMap = new Map<string, { x: number; y: number; w: number; h: number; nos: number[] }>();

      for (const item of g.items) {
        if (!item.mdaPageNo) continue;
        const idx = parseInt(item.mdaPageNo) - 1;
        if (isNaN(idx) || idx < 0 || idx >= total) continue;
        pageSet.add(idx);
        if (item.mdaMatchX && item.mdaMatchY && item.mdaRowHeight && item.mdaPageWidth && item.mdaPageHeight) {
          const srcPage = srcPdf.getPage(idx);
          const scaleY = srcPage.getHeight() / parseFloat(item.mdaPageHeight);
          const y = parseFloat(item.mdaMatchY) * scaleY - 2;
          const key = `${idx}:${y.toFixed(1)}`;
          const existing = hlMap.get(key);
          if (existing) {
            existing.nos.push(item.no);
          } else {
            hlMap.set(key, {
              x: 0,
              y,
              w: srcPage.getWidth(),
              h: parseFloat(item.mdaRowHeight) * scaleY + 4,
              nos: [item.no],
            });
          }
        }
      }

      const highlights = new Map<number, Array<{ x: number; y: number; w: number; h: number; nos: number[] }>>();
      for (const [key, hl] of hlMap) {
        const idx = parseInt(key.split(":")[0]);
        const arr = highlights.get(idx) ?? [];
        arr.push(hl);
        highlights.set(idx, arr);
      }

      const sortedIdx = [...pageSet].sort((a, b) => a - b);
      const copied = await mergedPdf.copyPages(srcPdf, sortedIdx);
      sortedIdx.forEach((srcIdx, i) => {
        const page = copied[i];
        for (const hl of highlights.get(srcIdx) ?? []) {
          page.drawRectangle({ x: hl.x, y: hl.y, width: hl.w, height: hl.h, color: rgb(1, 1, 0), opacity: 0.3 });
          if (hl.nos.length > 0) {
            const label = hl.nos.slice().sort((a, b) => a - b).join(", ");
            const fontSize = Math.max(7, Math.min(10, hl.h * 0.75));
            const badgeW = font.widthOfTextAtSize(label, fontSize) + 6;
            const badgeH = hl.h;
            const badgeX = hl.w - badgeW - 2;
            const badgeY = hl.y;
            page.drawRectangle({ x: badgeX, y: badgeY, width: badgeW, height: badgeH, color: rgb(0.09, 0.29, 0.65), opacity: 0.9 });
            page.drawText(label, {
              x: badgeX + 3,
              y: badgeY + (badgeH - fontSize) / 2 + 1,
              size: fontSize,
              font,
              color: rgb(1, 1, 1),
            });
          }
        }
        mergedPdf.addPage(page);
      });
    } catch {
      /* skip unavailable cert */
    }
  }

  if (mergedPdf.getPageCount() === 0) {
    return new Response("No MDA certificate pages could be retrieved", { status: 404 });
  }

  const bytes = await mergedPdf.save();

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="mda-certificates.pdf"`,
    },
  });
}
