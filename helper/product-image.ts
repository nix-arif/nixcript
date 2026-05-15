// lib/product-image.ts
export function getProductImageUrl(productCode: string): string {
  const base = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL;
  if (!base) return "";
  return `${base}/${encodeURIComponent(productCode)}`;
}
