// Why itemized pricing can't include a product without a valid MDA
// registration (shared by the server check and the forms' warnings)
export function pricedWithoutMdaMessage(codes: string[]): string {
  return `Itemized price won't tally: ${codes.join(", ")} ${codes.length > 1 ? "have" : "has"} no valid MDA registration, so ${codes.length > 1 ? "they" : "it"} won't be displayed on the customer copy — the customer copy total won't match what you intend to invoice. Remove ${codes.length > 1 ? "them" : "it"}, update the MDA details, or use a Total price.`;
}
