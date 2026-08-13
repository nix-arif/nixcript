// Shared allow-list for the presigned-upload routes (claim/leave/ledger/
// travel-form docs). These routes only ever see the client's *declared*
// fileName/mimeType/fileSize — the actual bytes go straight from the
// browser to R2 via the presigned URL, so this can't verify the real
// content matches what was declared. What it does close: rejecting
// executable/markup extensions up front means R2 never ends up serving
// back attacker-chosen HTML/SVG/JS with an attacker-chosen Content-Type
// to someone who later opens an uploaded "receipt".
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  "pdf", "jpg", "jpeg", "png", "gif", "webp", "heic",
  "doc", "docx", "xls", "xlsx", "csv", "txt",
]);

const MAX_DECLARED_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

export function validateUploadRequest(
  fileName: string,
  fileSize: number,
): string | null {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    return `File type ".${ext || "unknown"}" is not allowed`;
  }
  if (fileSize > MAX_DECLARED_UPLOAD_SIZE_BYTES) {
    return "File exceeds the 25MB size limit";
  }
  return null;
}
