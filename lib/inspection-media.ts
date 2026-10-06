// Inspection evidence (packing list → inspect) can be photos or videos. Both
// live in the same inspection_photo table; which one a file is follows from
// its extension, so no extra column is needed.

export type InspectionMediaKind = "image" | "video";

export const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];
export const VIDEO_EXTS = ["mp4", "mov", "m4v", "webm", "3gp"];

export const MAX_IMAGE_MB = 5;
export const MAX_VIDEO_MB = 200;

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function mediaKindOf(keyOrName: string): InspectionMediaKind {
  return VIDEO_EXTS.includes(extOf(keyOrName)) ? "video" : "image";
}

/** What the file input accepts — photos and videos, camera included on phones. */
export const INSPECTION_MEDIA_ACCEPT = "image/*,video/*";

/** Why a file can't be attached, or null when it's fine. */
export function inspectionMediaProblem(file: File): string | null {
  const ext = extOf(file.name);
  const isVideo = file.type.startsWith("video/") || VIDEO_EXTS.includes(ext);
  const isImage = file.type.startsWith("image/") || IMAGE_EXTS.includes(ext);
  if (isVideo) {
    if (!VIDEO_EXTS.includes(ext)) return "Unsupported video — please use MP4, MOV, WebM or 3GP.";
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      return `Video too large — maximum is ${MAX_VIDEO_MB} MB (this one is ${(file.size / 1024 / 1024).toFixed(0)} MB). Record a shorter clip.`;
    }
    return null;
  }
  if (isImage) {
    if (!IMAGE_EXTS.includes(ext) && !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      return "Unsupported format — please use JPG, PNG, WebP or GIF.";
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      return `File too large — maximum is ${MAX_IMAGE_MB} MB (this file is ${(file.size / 1024 / 1024).toFixed(1)} MB).`;
    }
    return null;
  }
  return "Only photos and videos can be attached.";
}
