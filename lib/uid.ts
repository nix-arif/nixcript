import { nanoid } from "nanoid";

/**
 * Works in all browser contexts (HTTP + HTTPS).
 * crypto.randomUUID() only works in secure contexts (HTTPS / localhost).
 */
export const uid = () => nanoid();
