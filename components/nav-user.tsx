"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { useAppStore } from "@/lib/store/use-app-store";
import { ChevronsUpDownIcon, UserCircleIcon, LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

export function NavUser() {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const { clearPermissions } = useAppStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || isPending) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" disabled className="gap-3">
            <div className="size-8 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 w-20 rounded bg-muted animate-pulse" />
              <div className="h-2 w-28 rounded bg-muted animate-pulse" />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  if (!session?.user) return null;
  const user = session.user;
  const initials = user.name
    ? user.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "??";

  const handleSignOut = async () => {
    clearPermissions();
    await authClient.signOut();
    router.push("/auth/login");
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground gap-3"
            >
              <Avatar className="size-8 rounded-full shrink-0">
                {user.image && <AvatarImage src={user.image} alt={user.name} />}
                <AvatarFallback className="rounded-full text-xs font-semibold" suppressHydrationWarning>
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">{user.name}</span>
                <span className="truncate text-[11px] text-muted-foreground">{user.email}</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4 text-muted-foreground shrink-0" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-xl p-1.5"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={6}
          >
            {/* User info header */}
            <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
              <Avatar className="size-9 rounded-full shrink-0">
                {user.image && <AvatarImage src={user.image} alt={user.name} />}
                <AvatarFallback className="rounded-full text-xs font-semibold" suppressHydrationWarning>
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 leading-tight min-w-0">
                <span className="truncate text-sm font-semibold">{user.name}</span>
                <span className="truncate text-[11px] text-muted-foreground">{user.email}</span>
              </div>
            </div>

            <DropdownMenuSeparator className="my-1" />

            <DropdownMenuItem
              className="flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-pointer"
              onClick={() => router.push("/dashboard/profile/my-profile")}
            >
              <UserCircleIcon className="size-4 text-muted-foreground" />
              <span className="text-sm">My profile</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator className="my-1" />

            <DropdownMenuItem
              className="flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-pointer text-destructive focus:text-destructive"
              onClick={handleSignOut}
            >
              <LogOutIcon className="size-4" />
              <span className="text-sm">Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
