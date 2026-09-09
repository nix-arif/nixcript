// Public catalogue image URL for a product/design code. Uploads
// (getProductImageUploadUrls / getDesignCodeImageUploadUrl in
// server/products.ts) always escape "/" to ":" before writing the R2 key,
// because a code containing "/" can't safely round-trip through a public
// bucket URL otherwise — so every read site has to apply that exact same
// escape, or a slash-containing code's image silently 404s even though the
// upload succeeded. Centralized here so that fix can't land in one call
// site and miss the others, which is exactly what happened before this was
// consolidated: about half the app's read sites escaped "/" and half didn't.
export function getProductImageUrl(code: string, ext: string = "jpg"): string {
  const base = process.env.NEXT_PUBLIC_R2_PRODUCT_IMAGES_URL;
  if (!base || !code) return "";
  return `${base}/${encodeURIComponent(code.replace(/\//g, ":"))}.${ext}`;
}
