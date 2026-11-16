// Ordering and numbering of Customer PO items.
//
// Items are shown grouped by set (sets in order of first appearance), followed by
// the items that belong to no set. That is the order the CPO detail page shows and
// the order the item numbers (#) follow. Moving an item only swaps it with its
// neighbour inside the same block (the same set, or the list of items not in a set),
// so it can never jump into another set by accident.

type Orderable = { _key: string; included: boolean; setGroupId?: string; _quotationId?: string };

// Same grouping the detail page uses: set groups first, then everything else
export function displayOrder<T extends Orderable>(items: T[]): T[] {
  const groupIds: string[] = [];
  for (const it of items) if (it.setGroupId && !groupIds.includes(it.setGroupId)) groupIds.push(it.setGroupId);
  return [
    ...groupIds.flatMap((gid) => items.filter((i) => i.setGroupId === gid)),
    ...items.filter((i) => !i.setGroupId),
  ];
}

// Item numbers (1, 2, 3 …) in display order. Items that are switched off get no
// number, so the saved numbers are always continuous.
export function itemNumbers<T extends Orderable>(items: T[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const it of displayOrder(items)) if (it.included) out.set(it._key, ++n);
  return out;
}

// Items inside a set move only within that set. Every item that is not in a set forms one
// block, even across different quotations, so they can be ordered freely among themselves.
const sameBlock = (a: Orderable, b: Orderable) => (a.setGroupId || "") === (b.setGroupId || "");

// Whether the item has a neighbour above / below it in its block
export function canMove<T extends Orderable>(items: T[], key: string): { up: boolean; down: boolean } {
  const me = items.find((i) => i._key === key);
  if (!me) return { up: false, down: false };
  const block = items.filter((i) => sameBlock(i, me));
  const at = block.findIndex((i) => i._key === key);
  return { up: at > 0, down: at < block.length - 1 };
}

// Swap the item with the neighbour above (-1) or below (+1) in its block
export function moveItem<T extends Orderable>(items: T[], key: string, dir: -1 | 1): T[] {
  const me = items.find((i) => i._key === key);
  if (!me) return items;
  const block = items.filter((i) => sameBlock(i, me));
  const at = block.findIndex((i) => i._key === key);
  const other = block[at + dir];
  if (!other) return items;
  const a = items.findIndex((i) => i._key === key);
  const b = items.findIndex((i) => i._key === other._key);
  const next = [...items];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
