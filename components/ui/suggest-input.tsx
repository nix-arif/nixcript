"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// A text input with a list of suggestions that match what is typed, styled like the rest of the app (the browser's
// own <datalist> popup cannot be styled). Free text is still allowed: the suggestions only fill the field in.
export function SuggestInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
  autoFocus,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const needle = value.trim().toLowerCase();
  const shown = React.useMemo(
    () => suggestions.filter((s) => s.toLowerCase().includes(needle) && s.toLowerCase() !== needle).slice(0, 50),
    [suggestions, needle],
  );

  React.useEffect(() => {
    const close = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  React.useEffect(() => { setActive(0); }, [needle]);
  React.useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (s: string) => { onChange(s); setOpen(false); };
  const visible = open && shown.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id={id}
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={placeholder}
        className={className}
        role="combobox"
        aria-expanded={visible}
        aria-autocomplete="list"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && visible) { e.preventDefault(); pick(shown[active]); }
          else if (e.key === "Escape" && visible) { e.stopPropagation(); setOpen(false); }
        }}
      />
      {visible && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
        >
          {shown.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setActive(i)}
              className={cn("cursor-pointer truncate rounded-md px-2.5 py-1.5", i === active && "bg-muted")}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
