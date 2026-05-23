interface Props {
  text: string | null | undefined;
  query: string;
  className?: string;
}

export function Highlight({ text, query, className }: Props) {
  const str = text ?? "";
  if (!query.trim() || !str) return <span className={className}>{str}</span>;

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = str.split(new RegExp(`(${escaped})`, "gi"));

  return (
    <span className={className}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="bg-yellow-200/80 dark:bg-yellow-700/40 text-inherit not-italic rounded-[2px] px-0"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </span>
  );
}
