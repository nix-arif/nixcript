"use client";

import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import CreateOrganizationForm from "./dialog-forms/create-organization-form";
import Image from "next/image";
import { authClient } from "@/lib/auth-client";
import { Spinner } from "./ui/spinner";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store/use-app-store";

export function OrganizationSwitcher() {
  const { isMobile } = useSidebar();
  const [isCreateOrgOpen, setIsCreateOrgOpen] = React.useState(false);
  const [pendingOrgId, setPendingOrgId] = React.useState<string | null>(null);
  const router = useRouter();
  const { clearPermissions } = useAppStore();

  const {
    data: activeOrganization,
    isPending: isActivePending,
    refetch: refetchActive,
  } = authClient.useActiveOrganization();

  const {
    data: organizationList,
    isPending: isListPending,
    refetch: refetchList,
  } = authClient.useListOrganizations();

  // ✅ ALL hooks before any conditional return
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refetchActive();
        refetchList();
      }
    };

    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        refetchActive();
        refetchList();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [refetchActive, refetchList]);

  React.useEffect(() => {
    if (!activeOrganization && organizationList && organizationList.length > 0) {
      authClient.organization
        .setActive({ organizationId: organizationList[0].id })
        .then(() => refetchActive());
    }
  }, [activeOrganization, organizationList]);

  // ✅ Conditional returns only after ALL hooks
  if (isListPending || isActivePending) {
    return (
      <SidebarMenu>
        <SidebarMenuButton size="lg">
          <Spinner /> Loading...
        </SidebarMenuButton>
      </SidebarMenu>
    );
  }

  if (!organizationList || organizationList.length === 0) {
    return (
      <>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              onClick={() => setIsCreateOrgOpen(true)}
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <PlusIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  Create Organization
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <CreateOrganizationForm
          isOpen={isCreateOrgOpen}
          onOpenChange={setIsCreateOrgOpen}
        />
      </>
    );
  }

  if (!activeOrganization) {
    return (
      <SidebarMenu>
        <SidebarMenuButton size="lg">
          <Spinner /> Setting up...
        </SidebarMenuButton>
      </SidebarMenu>
    );
  }

  // Optimistic display — show the selected org immediately while setActive runs
  const displayOrg = pendingOrgId
    ? (organizationList?.find(o => o.id === pendingOrgId) ?? activeOrganization)
    : activeOrganization;

  const handleSwitchOrg = (organizationId: string) => {
    if (organizationId === activeOrganization.id) return;
    if (pendingOrgId === organizationId) return;

    // 1. Instant: update sidebar display + navigate
    setPendingOrgId(organizationId);
    clearPermissions();
    router.push("/dashboard");

    // 2. Background: commit the switch, then refresh server components
    authClient.organization.setActive({ organizationId }).then(() => {
      refetchActive();
      router.refresh();
    }).catch((err) => {
      console.error("Failed to switch organization", err);
      setPendingOrgId(null);
    }).finally(() => {
      setPendingOrgId(null);
    });
  };

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg text-sidebar-primary-foreground bg-transparent!">
                  {displayOrg?.logo ? (
                    <Image
                      src={displayOrg.logo}
                      alt={displayOrg.name}
                      width={32}
                      height={32}
                      className="bg-transparent!"
                    />
                  ) : (
                    displayOrg?.name[0]
                  )}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {displayOrg?.name}
                  </span>
                </div>
                <ChevronsUpDownIcon className="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              align="start"
              side={isMobile ? "bottom" : "right"}
              sideOffset={4}
            >
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Organizations
              </DropdownMenuLabel>
              {organizationList.map((org, index) => (
                <DropdownMenuItem
                  key={org.id}
                  onClick={() => handleSwitchOrg(org.id)}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    {org.name[0]}
                  </div>
                  {org.name}
                  <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 p-2"
                onClick={() => setIsCreateOrgOpen(true)}
              >
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <PlusIcon className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  Add Organization
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <CreateOrganizationForm
        isOpen={isCreateOrgOpen}
        onOpenChange={setIsCreateOrgOpen}
      />
    </>
  );
}
