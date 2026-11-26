// Sales Orders and Purchase Requisitions get their running number only when they are approved,
// so a draft, submitted or rejected one never uses up a number (deleting it leaves no gap).
// Until then the number field holds a short draft reference, "DRAFT-7K3QX", which every list,
// search, PDF and notification shows like a number.

import { customAlphabet } from "nanoid";

export const DRAFT_PREFIX = "DRAFT-";

// no 0/O, 1/I/L: easy to read out and type
const ref = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 5);

export const newDraftRef = () => `${DRAFT_PREFIX}${ref()}`;

/** True while the document has a draft reference and no running number yet. */
export const isDraftRef = (no: string | null | undefined) => !!no && no.startsWith(DRAFT_PREFIX);
