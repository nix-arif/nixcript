"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { useState, useEffect } from "react";

// Returns true only if this url is the best match for pathname.
// "Best match" means: no sibling url is a longer, more specific match.
function isActiveSub(url: string, siblings: string[], pathname: string): boolean {
  if (pathname !== url && !pathname.startsWith(url + "/")) return false;
  return !siblings.some(
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
  const { isMobile, setOpenMobile } = useSidebar();
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});

  // Reset manual overrides whenever the route changes
  useEffect(() => {
    setManualOpen({});
  }, [pathname]);

  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SidebarGroup className="px-2 py-1">
      <SidebarMenu className="gap-0.5">
        {items.map((item) => {
          const subUrls = item.items?.map((s) => s.url) ?? [];

          const isGroupActive = item.items?.some((sub) =>
            isActiveSub(sub.url, subUrls, pathname),
          ) ?? false;

          const isOpen = isGroupActive || (manualOpen[item.title] ?? false);

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
                    tooltip={item.title}
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
                      const isActive = isActiveSub(subItem.url, subUrls, pathname);
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
