import { getPoForPrint } from "@/server/purchase-order";
import { generatePurchaseOrderPdf, type PoPdfOptions } from "@/app/dashboard/procurement/purchase-order/[id]/print/generate-po-pdf";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface Props {
  params: Promise<{ id: string }>;
}

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const PROCUREMENT_BUCKET = process.env.R2_PROCUREMENT_IMAGES_BUCKET!;
const CATALOG_URL        = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL ?? "";

async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; format: "jpg" | "png" } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    const format: "jpg" | "png" = ct.includes("png") ? "png" : "jpg";
    return { bytes: new Uint8Array(await res.arrayBuffer()), format };
  } catch {
    return null;
  }
}

export async function GET(req: Request, { params }: Props) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const withImages = url.searchParams.get("withImages") === "1";

  let data;
  try {
    data = await getPoForPrint(id);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  if (!data) return new Response("Not Found", { status: 404 });
  if (data.order.status !== "confirmed") {
    return new Response("PDF is only available for confirmed purchase orders", { status: 403 });
  }

  const options: PoPdfOptions = { withImages };

  if (withImages) {
    const itemImages: PoPdfOptions["itemImages"] = new Map();

    await Promise.all(
      data.items.map(async (item) => {
        let imgUrl: string | null = null;

        if (item.imageKey) {
          // Custom uploaded image — generate presigned URL
          try {
            const cmd = new GetObjectCommand({ Bucket: PROCUREMENT_BUCKET, Key: item.imageKey });
            imgUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
          } catch { /* fall through to catalog */ }
        }

        // Fallback to public catalog image
        if (!imgUrl && item.productCode && CATALOG_URL) {
          imgUrl = `${CATALOG_URL}/${encodeURIComponent(item.productCode)}.jpg`;
        }

        if (imgUrl) {
          const result = await fetchImageBytes(imgUrl);
          if (result) itemImages.set(item.rowNo, result);
        }
      }),
    );

    options.itemImages = itemImages;
  }

  let bytes: Uint8Array;
  try {
    bytes = await generatePurchaseOrderPdf(data, options);
  } catch (err) {
    console.error("[purchase-order/pdf/route] PDF generation failed:", err);
    return new Response("PDF generation failed", { status: 500 });
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${data.order.poNo}.pdf"`,
    },
  });
}
