"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";

// Returns true only if this url is the best match for pathname across ALL nav sub-items.
// "Best match" means: no other registered url is a longer, more specific match.
function isActiveSub(url: string, allUrls: string[], pathname: string): boolean {
  if (pathname !== url && !pathname.startsWith(url + "/")) return false;
  return !allUrls.some(
    (s) => s !== url && s.startsWith(url) && (pathname === s || pathname.startsWith(s + "/")),
  );
}

export function NavMain({
  items,
}: {
  items: {
    title: string;
    url: string;
    icon?: React.ReactNode;
    isActive?: boolean;
    items?: {
      title: string;
      url: string;
    }[];
  }[];
}) {
  const pathname = usePathname();
  const { isMobile, state, setOpenMobile } = useSidebar();
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});
  // Sub-items are hidden by CSS once the sidebar collapses to icons
  // (SidebarMenuSub has group-data-[collapsible=icon]:hidden), so the usual
  // inline expand/collapse becomes unreachable — swap to a flyout dropdown
  // instead so child nav stays usable while collapsed.
  const isIconCollapsed = state === "collapsed" && !isMobile;

  // Icon-collapsed flyout opens on hover rather than click. A short close
  // delay (instead of closing the instant the cursor leaves the trigger)
  // gives the user room to move diagonally into the flyout across the gap
  // created by sideOffset — without it, the menu would close before the
  // cursor ever reaches the content.
  const [hoveredTitle, setHoveredTitle] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const openFlyout = (title: string) => {
    clearCloseTimer();
    setHoveredTitle(title);
  };
  const scheduleCloseFlyout = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setHoveredTitle(null), 150);
  };
  useEffect(() => clearCloseTimer, []);

  // Reset manual overrides whenever the route changes
  useEffect(() => {
    setManualOpen({});
    setHoveredTitle(null);
  }, [pathname]);

  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const allSubUrls = items.flatMap((item) => item.items?.map((s) => s.url) ?? []);

  return (
    <SidebarGroup className="px-2 py-1">
      <SidebarMenu className="gap-0.5">
        {items.map((item) => {
          const isGroupActive = item.items?.some((sub) =>
            isActiveSub(sub.url, allSubUrls, pathname),
          ) ?? false;

          const isOpen = isGroupActive || (manualOpen[item.title] ?? false);

          if (isIconCollapsed) {
            return (
              <SidebarMenuItem
                key={item.title}
                onMouseEnter={() => openFlyout(item.title)}
                onMouseLeave={scheduleCloseFlyout}
              >
                <DropdownMenu
                  open={hoveredTitle === item.title}
                  onOpenChange={(open) => {
                    if (open) openFlyout(item.title);
                    else { clearCloseTimer(); setHoveredTitle(null); }
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    {/* No tooltip here — the flyout itself (opened on hover)
                        already labels the group via DropdownMenuLabel below,
                        so a tooltip would just be a redundant second label. */}
                    <SidebarMenuButton
                      isActive={isGroupActive}
                      className={`h-8 rounded-md gap-2.5 text-[13px] font-medium transition-colors
                        ${isGroupActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                        }`}
                    >
                      <span className="shrink-0 [&_svg]:size-4 [&_svg]:opacity-80">{item.icon}</span>
                      <span className="truncate">{item.title}</span>
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="right"
                    align="center"
                    sideOffset={10}
                    className="w-52 rounded-xl p-1.5"
                    onMouseEnter={() => openFlyout(item.title)}
                    onMouseLeave={scheduleCloseFlyout}
                  >
                    <DropdownMenuLabel className="flex items-center gap-2 px-1.5 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      <span className="shrink-0 [&_svg]:size-3.5 [&_svg]:opacity-70">{item.icon}</span>
                      {item.title}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="my-1" />
                    <div className="flex flex-col gap-0.5">
                      {item.items?.map((subItem) => {
                        const isActive = isActiveSub(subItem.url, allSubUrls, pathname);
                        return (
                          <DropdownMenuItem
                            key={subItem.title}
                            asChild
                            className={`h-8 rounded-md px-2 text-[13px] transition-colors
                              ${isActive
                                ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground focus:bg-sidebar-accent"
                                : "text-sidebar-foreground/80 focus:bg-sidebar-accent/60 focus:text-sidebar-foreground"
                              }`}
                          >
                            <Link href={subItem.url} onClick={closeMobile}>
                              {subItem.title}
                            </Link>
                          </DropdownMenuItem>
                        );
                      })}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            );
          }

          return (
            <Collapsible
              key={item.title}
              asChild
              open={isOpen}
              onOpenChange={(open) =>
                setManualOpen((prev) => ({ ...prev, [item.title]: open }))
              }
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    isActive={isGroupActive}
                    className={`h-8 rounded-md gap-2.5 text-[13px] font-medium transition-colors
                      ${isGroupActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                      }`}
                  >
                    <span className="shrink-0 [&_svg]:size-4 [&_svg]:opacity-80">{item.icon}</span>
                    <span className="truncate">{item.title}</span>
                    <ChevronRightIcon className="ml-auto size-3.5 shrink-0 opacity-50 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <SidebarMenuSub className="ml-5 border-l border-sidebar-border/60 pl-2 py-0.5 gap-0">
                    {item.items?.map((subItem) => {
                      const isActive = isActiveSub(subItem.url, allSubUrls, pathname);
                      return (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive}
                            className={`h-7 rounded-md text-[12px] transition-colors
                              ${isActive
                                ? "text-sidebar-accent-foreground font-semibold bg-sidebar-accent"
                                : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/40"
                              }`}
                          >
                            <Link href={subItem.url} onClick={closeMobile}>
                              {subItem.title}
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
