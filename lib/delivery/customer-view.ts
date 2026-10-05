// How a Case DO line is printed on the customer copy — shared by DO lines and
// doctor case templates (server/case-template.ts, server/delivery-order.ts).
// Stock is always deducted for the actual item; the internal copy shows both.

export interface CustomerView {
  custShow?: "product" | "text" | "hide" | "kit" | null;
  custProductId?: string | null;
  custCode?: string | null;
  custDescription?: string | null;
  custQty?: string | null;
  custUom?: string | null;
  custReason?: string | null;
}
/** Clean a customer-copy setting; returns an error text when it's incomplete. */
export function cleanCustomerView(v: CustomerView, needReason: boolean): { view: Required<CustomerView> } | { error: string } {
  const show = v.custShow && ["product", "text", "hide", "kit"].includes(v.custShow) ? v.custShow : null;
  const t = (x?: string | null) => x?.trim() || null;
  const view: Required<CustomerView> = { custShow: show, custProductId: null, custCode: null, custDescription: null, custQty: null, custUom: null, custReason: null };
  if (!show) return { view };
  view.custReason = t(v.custReason);
  const qty = t(v.custQty);
  if (qty && !(parseFloat(qty) > 0)) return { error: "Customer copy quantity must be above 0" };
  view.custQty = qty;
  if (show === "product") {
    if (!v.custProductId || !t(v.custCode)) return { error: "Choose the product to show on the customer copy" };
    if (needReason && !view.custReason) return { error: "Give a reason for showing a different product on the customer copy" };
    Object.assign(view, { custProductId: v.custProductId, custCode: t(v.custCode), custDescription: t(v.custDescription), custUom: t(v.custUom) });
  } else if (show === "text") {
    if (!t(v.custDescription) && !t(v.custCode)) return { error: "Enter the code or description to show on the customer copy" };
    Object.assign(view, { custCode: t(v.custCode), custDescription: t(v.custDescription), custUom: t(v.custUom) });
  } else if (show === "kit") {
    if (!t(v.custDescription)) return { error: "Enter the kit name to show on the customer copy" };
    Object.assign(view, { custCode: t(v.custCode), custDescription: t(v.custDescription), custUom: t(v.custUom) });
  }
  return { view };
}
