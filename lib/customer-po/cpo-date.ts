// The date a customer PO is listed and sorted by: the date it was received, or (when that was not filled in) the day
// it was recorded. Lists show this date, so they sort by it too, newest first: a PO received on 3 Nov but recorded on
// 20 Nov sits with 3 Nov, not with the POs recorded on 20 Nov. Dates are Malaysian calendar days (UTC+8); POs of the
// same day are newest-recorded first. No database here, safe for client code.

type CpoDates = { receivedDate: Date | string | null; createdAt: Date | string };

const KL_OFFSET_MS = 8 * 60 * 60 * 1000;

// "YYYY-MM-DD" in Malaysia time
export function cpoDay(p: CpoDates): string {
  const d = new Date(p.receivedDate ?? p.createdAt);
  return new Date(d.getTime() + KL_OFFSET_MS).toISOString().slice(0, 10);
}

// for Array.sort: newest date first, then newest recorded first
export function compareCpoNewestFirst(a: CpoDates, b: CpoDates): number {
  const da = cpoDay(a), db = cpoDay(b);
  if (da !== db) return da < db ? 1 : -1;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}
