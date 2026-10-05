// A draft DO carries a temporary reference, not a number from the running
// sequence: the real DO number is given only when it is marked as delivered,
// so deleting or cancelling a draft never leaves a gap in the numbering.
const DRAFT_PREFIX = "DRAFT-";

export const draftDoNo = (id: string) => DRAFT_PREFIX + id.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase();

export const isDraftDoNo = (doNo: string | null | undefined) => !!doNo && doNo.startsWith(DRAFT_PREFIX);
