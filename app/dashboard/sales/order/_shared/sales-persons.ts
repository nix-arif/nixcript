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
