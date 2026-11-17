// Customer PO numbers that are not the customer's own PO number yet.
//  - PO-TBC-<org code>-001 : "PO to follow", a temporary number until the real PO arrives
//  - CASH-SALE-01          : the customer never issues a PO
export const PO_TBC_PREFIX = "PO-TBC-";
export const isTemporaryPoNo = (no: string | null | undefined) => !!no && /^PO-TBC-/i.test(no.trim());
export const isCashSaleNo = (no: string | null | undefined) => !!no && /^CASH-SALE-\d+$/i.test(no.trim());
