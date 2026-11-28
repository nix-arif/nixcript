// A sales order's sales people. With customer POs linked, each PO has its own list (first = its main one).

type Person = { id: string; name: string };

/** Typed in by name, or a name with no matching member: not a company member (members carry their user id). */
export const isExternalPerson = (p: { id: string }) => /^(ext|sp|mem)-/.test(p.id);

/**
 * Everyone besides the order's main sales person (the first PO's first), each once: the first PO's other
 * people, and all of every later PO's, their main one included. `lists`: one per linked PO, in order.
 */
export function orderAssociates(lists: Person[][]): Person[] {
  const main = lists[0]?.[0];
  const seen = new Set(main ? [main.id, main.name.trim().toLowerCase()] : []);
  const out: Person[] = [];
  for (const { id, name } of lists.flatMap((l, i) => l.slice(i === 0 ? 1 : 0))) {
    const key = name.trim().toLowerCase();
    if (seen.has(id) || seen.has(key)) continue;
    seen.add(id).add(key);
    out.push({ id, name });
  }
  return out;
}

// Urgent / pro-forma orders without a customer PO keep sales people per quotation (main one + others).

type QuotationPeople = { salesPersonName?: string | null; associateSalesPersons?: Person[] | null };
const nameKey = (name: string) => name.trim().toLowerCase();

/** Every sales person named on the quotations, main ones first within each. A main one is a name only. */
export function quotationPeople(qts: QuotationPeople[]): Person[] {
  return qts.flatMap((q) => [
    ...(q.salesPersonName ? [{ id: `sp-${q.salesPersonName}`, name: q.salesPersonName }] : []),
    ...(q.associateSalesPersons ?? []),
  ]);
}

/**
 * The quotations' sales people after the order's one list of them was edited (the edit page has no
 * per-quotation rows): someone removed leaves every quotation, someone added joins the first, the
 * list's first person is the first quotation's main one, and a quotation left with nobody gets them too.
 */
export function reconcileQuotationSalesPersons<T extends QuotationPeople>(qts: T[], list: Person[]): T[] {
  const kept = new Map(list.map((p) => [nameKey(p.name), p]));
  const mine = qts.map((q) => [...new Set(quotationPeople([q]).map((p) => nameKey(p.name)))].filter((k) => kept.has(k)));
  if (qts.length > 0 && list.length > 0) {
    const main = nameKey(list[0].name);
    const added = [...kept.keys()].filter((k) => !mine.some((m) => m.includes(k)));
    mine[0] = [...new Set([main, ...mine[0], ...added])];
    mine.forEach((m) => { if (m.length === 0) m.push(main); });
  }
  return qts.map((q, i) => {
    const people = mine[i].map((k) => kept.get(k)!);
    return {
      ...q,
      salesPersonName: people[0]?.name ?? null,
      associateSalesPersons: people.slice(1).map(({ id, name }) => ({ id, name })),
    };
  });
}
