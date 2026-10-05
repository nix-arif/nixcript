// Whether an MDA registration is valid on a date (the case date): a
// registration no. and not past its expiry. Same rule the Case DO customer
// copy uses to decide what may be handed to the hospital.
export function isMdaValid(regNo: string | null | undefined, expiredOn: string | Date | null | undefined, onDate: Date = new Date()): boolean {
  if (!regNo?.trim()) return false;
  if (!expiredOn) return true;
  return new Date(expiredOn) >= new Date(onDate.toDateString());
}
