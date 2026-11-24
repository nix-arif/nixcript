"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { hasInAppHistory } from "@/hooks/use-back";

// A Back button that stays a real link to `fallback` — so middle-click and
// "open in new tab" still work — but on a plain click returns to the previous
// in-app page when there is one (see hooks/use-back.ts).
export function BackButton({
  fallback,
  children,
  ...buttonProps
}: { fallback: string; children: ReactNode } & Omit<ComponentProps<typeof Button>, "asChild" | "onClick">) {
  const router = useRouter();
  return (
    <Button asChild {...buttonProps}>
      <Link
        href={fallback}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab/window: follow the link
          if (hasInAppHistory()) {
            e.preventDefault();
            router.back();
          }
        }}
      >
        {children}
      </Link>
    </Button>
  );
}
