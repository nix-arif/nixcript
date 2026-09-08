import { useCallback, type KeyboardEvent, type RefObject } from "react";

// Only plain form controls — deliberately excludes buttons (including
// Radix Select's button-rendered trigger) so action buttons like Save/Add
// Item never get treated as navigable fields.
const FIELD_SELECTOR = "input:not([type=hidden]):not([type=file]), textarea, select";

function isNavigable(el: Element | null): el is HTMLElement {
  return !!el && el instanceof HTMLElement && !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.offsetParent !== null;
}

function focusField(el: HTMLElement) {
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
}

// Ctrl/Cmd+Arrow field navigation.
//
// Inside a line-item table (the focused field sits in a <td>), navigation is
// spreadsheet-style: Right/Left move to the next/previous column in the same
// row, Up/Down move to the same column in the row above/below — skipping
// over cells with no field (row-number columns, group-header colSpan rows,
// action-only columns) rather than stopping on them.
//
// Outside any table (plain header-level fields), there's no row/column
// structure to hop through, so it falls back to a simple next/prev walk in
// DOM order — and only for Up/Down, since Ctrl+Left/Right (Windows) and
// Cmd+Left/Right (Mac) are native text-cursor shortcuts (word jump / line
// start-end) that would otherwise get silently broken while typing.
export function useArrowFieldNav<T extends HTMLElement>(containerRef: RefObject<T | null>) {
  return useCallback(
    (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const dir =
        e.key === "ArrowDown" ? "down" :
        e.key === "ArrowUp" ? "up" :
        e.key === "ArrowRight" ? "right" :
        e.key === "ArrowLeft" ? "left" :
        null;
      if (!dir) return;

      const container = containerRef.current;
      if (!container) return;
      const target = e.target as HTMLElement;

      const cell = target.closest("td, th");
      const row = cell?.closest("tr") ?? null;
      const table = row?.closest("table") ?? null;

      if (cell && row && table && container.contains(row)) {
        const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
        const rowIdx = rows.indexOf(row as HTMLTableRowElement);
        const cellsInRow = Array.from(row.children) as HTMLElement[];
        const colIdx = cellsInRow.indexOf(cell as HTMLElement);
        if (rowIdx === -1 || colIdx === -1) return;

        if (dir === "left" || dir === "right") {
          const step = dir === "right" ? 1 : -1;
          for (let c = colIdx + step; c >= 0 && c < cellsInRow.length; c += step) {
            const field = cellsInRow[c].querySelector<HTMLElement>(FIELD_SELECTOR);
            if (isNavigable(field)) { e.preventDefault(); focusField(field); return; }
          }
          return;
        }

        const step = dir === "down" ? 1 : -1;
        for (let r = rowIdx + step; r >= 0 && r < rows.length; r += step) {
          const targetCell = (Array.from(rows[r].children) as HTMLElement[])[colIdx];
          const field = targetCell?.querySelector<HTMLElement>(FIELD_SELECTOR) ?? null;
          if (isNavigable(field)) { e.preventDefault(); focusField(field); return; }
        }
        return;
      }

      if (dir !== "up" && dir !== "down") return;
      const fields = Array.from(container.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(isNavigable);
      const idx = fields.indexOf(target);
      if (idx === -1) return;
      const next = fields[dir === "down" ? idx + 1 : idx - 1];
      if (!next) return;
      e.preventDefault();
      focusField(next);
    },
    [containerRef],
  );
}
