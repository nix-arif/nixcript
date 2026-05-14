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

const projects = [
  { name: "Design Engineering", url: "#", icon: <FrameIcon /> },
  { name: "Sales & Marketing", url: "#", icon: <PieChartIcon /> },
  { name: "Travel", url: "#", icon: <MapIcon /> },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { permissions } = useAppStore();
  const filteredNav = filterNav(navConfig, permissions);

  console.log("app-sidebar.tsx line 30", permissions);
  console.log("app-sidebar.tsx line 31", filteredNav);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <OrganizationSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={filteredNav} />
        <NavProjects projects={projects} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
