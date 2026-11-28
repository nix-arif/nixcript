// Where an item row goes when it's moved with the arrow keys on its drag handle.

type Row = { _key: string; setGroupId?: string; sourceQuotationId?: string };

/**
 * The key of the row whose place the moved row takes, or null when it can't move that way.
 * `shown` is the rows in the order they're on screen. `sorted`: urgent / pro-forma orders, whose rows are
 * shown by quotation and set, so a row only moves among its neighbours of the same quotation and set.
 */
export function keyboardMoveTarget(shown: Row[], index: number, step: -1 | 1, sorted: boolean): string | null {
  const row = shown[index];
  if (!row) return null;
  if (sorted) {
    const next = shown[index + step];
    const sameSection = next
      && (next.sourceQuotationId || "") === (row.sourceQuotationId || "")
      && (next.setGroupId || "") === (row.setGroupId || "");
    return sameSection ? next._key : null;
  }
  // an item outside a set can't go into one (as with dragging): it passes the whole set
  let to = index + step;
  if (!row.setGroupId) while (shown[to]?.setGroupId) to += step;
  const passedSet = to !== index + step;
  return shown[passedSet ? to - step : to]?._key ?? null;
}
