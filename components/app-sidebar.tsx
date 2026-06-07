// components/app-sidebar.tsx
"use client";

import * as React from "react";
import { NavMain } from "@/components/nav-main";
import { NavProjects } from "@/components/nav-projects";
import { NavUser } from "@/components/nav-user";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { FrameIcon, PieChartIcon, MapIcon } from "lucide-react";
import { filterNav, navConfig } from "@/lib/nav";
import { useAppStore } from "@/lib/store/use-app-store";

// const projects = [
//   { name: "Design Engineering", url: "#", icon: <FrameIcon /> },
//   { name: "Sales & Marketing", url: "#", icon: <PieChartIcon /> },
//   { name: "Travel", url: "#", icon: <MapIcon /> },
// ];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { permissions, permissionsLoading } = useAppStore();
  const filteredNav = filterNav(navConfig, permissions);

  // console.log("app-sidebar.tsx line 30", permissions);
  // console.log("app-sidebar.tsx line 31", filteredNav);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="border-b border-sidebar-border/60 pb-2">
        <OrganizationSwitcher />
      </SidebarHeader>
      <SidebarContent className="overflow-y-auto">
        <div className={`transition-opacity duration-150 ${permissionsLoading ? "pointer-events-none opacity-30" : "opacity-100"}`}>
          <NavMain items={filteredNav} />
        </div>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/60 pt-2">
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
