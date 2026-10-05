import { BookOpenIcon, ChevronRightIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MANUALS } from "@/lib/manuals";

export default function DocumentationPage() {
  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <PageHeader title="Documentation" description="User manuals — open in a new tab" />
      <div className="flex flex-col gap-2">
        {MANUALS.map((m) => (
          <a key={m.slug} href={`/manuals/${m.slug}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 p-3.5 border border-border rounded-xl hover:bg-muted/40 transition-colors group">
            <div className="w-9 h-9 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg flex items-center justify-center text-base shrink-0">{m.icon}</div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{m.title}</p>
              <p className="text-xs text-muted-foreground">{m.description}</p>
            </div>
            <ChevronRightIcon className="ml-auto w-4 h-4 text-muted-foreground shrink-0" />
          </a>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1.5"><BookOpenIcon className="w-3.5 h-3.5" /> Manuals are only available to signed-in users.</p>
    </div>
  );
}
