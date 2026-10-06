import { FlagIcon } from "lucide-react";

// Red bar fixed across the top of every page, plus a red frame round the
// window, on the testing deployment only (see lib/testing-mode.ts).
export function TestingBanner() {
  return (
    <>
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-40 flex h-(--testing-bar) items-center justify-center gap-2 bg-red-600 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-white shadow-sm sm:text-xs"
      >
        <FlagIcon className="h-3.5 w-3.5 fill-white" />
        Testing mode
        <span className="hidden font-medium normal-case tracking-normal opacity-90 sm:inline">
          — test data only, nothing here is real
        </span>
        <FlagIcon className="h-3.5 w-3.5 fill-white" />
      </div>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-40 border-[3px] border-red-600" />
    </>
  );
}
