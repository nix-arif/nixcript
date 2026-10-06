// A testing deployment (same code, connected to the dev database) sets
// NEXT_PUBLIC_TESTING_MODE=true: every page shows a red TESTING MODE banner,
// search engines are told not to index it, and emails are marked [TESTING].
// Production leaves it unset.
export const TESTING_MODE = process.env.NEXT_PUBLIC_TESTING_MODE === "true";

/** Prefix an email subject so nobody mistakes a test email for a real one. */
export function testingSubject(subject: string): string {
  return TESTING_MODE ? `[TESTING] ${subject}` : subject;
}
