"use client";

import * as React from "react";
import { useCallback, useEffect } from "react";
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
  const { clearPermissions, fetchPermissions, setOrgSwitching } = useAppStore();

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
    // ── pageshow (bfcache restore) ────────────────────────────────────────
    // Fires when the browser restores a frozen page from the back/forward cache.
    // The session/org may have changed in other tabs while the page was cached,
    // so a refetch is genuinely needed here.
    //
    // NOTE: popstate (browser back/forward) is intentionally omitted.
    // This is an SPA — client-side navigation via Next.js Link or router.push
    // does NOT reload the JS heap, so nanostores data remains valid across pops.
    // Firing refetchAll() on every popstate caused an unnecessary round-trip on
    // the very first back-button press after mount (because lastPopStateRefetch
    // starts at 0, which is always past any cooldown threshold).
    //
    // NOTE: visibilitychange is also intentionally omitted — better-auth already
    // handles tab-focus refetching internally via its WindowFocusManager
    // (session-refresh.mjs). That is disabled by sessionOptions.refetchOnWindowFocus:false
    // in authClient to avoid the cross-tab cascade. Adding a manual listener here
    // would duplicate the request.
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        refetchActive();
        refetchList();
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [refetchActive, refetchList]);

  // Only auto-set once — when the user has NEVER had an active org this session.
  // hasBootstrappedRef — goes false→true once BOTH queries have returned real
  // data. After that point the loading spinner is permanently suppressed so that
  // transient null states (HMR re-init, 401, component remount before re-fetch)
  // fall through to the displayOrg fallback instead of flashing a spinner.
  const hasBootstrappedRef = React.useRef(false);

  // hasEverHadOrgRef — prevents the auto-set effect from re-firing when
  // activeOrganization briefly goes null during a refetch (e.g. after
  // router.refresh() or switching orgs).
  //
  // IMPORTANT: wait for both pending states to resolve first.
  // On hard reload, organizationList can finish before useActiveOrganization —
  // without the pending guard the effect fires while activeOrganization is still
  // loading (null) and resets the active org to organizationList[0].
  const hasEverHadOrgRef = React.useRef(false);
  const autoSettingRef = React.useRef(false);
  React.useEffect(() => {
    // Still loading — don't make any decisions yet
    if (isActivePending || isListPending) return;

    if (activeOrganization) {
      hasEverHadOrgRef.current = true;
      autoSettingRef.current = false;
      return;
    }
    if (hasEverHadOrgRef.current) return; // transient null during refetch — ignore
    if (!organizationList || organizationList.length === 0) return;
    if (autoSettingRef.current) return;

    autoSettingRef.current = true;
    authClient.organization
      .setActive({ organizationId: organizationList[0].id })
      .then(() => refetchActive())
      .catch(() => {
        autoSettingRef.current = false;
      });
  }, [activeOrganization, organizationList, isActivePending, isListPending]);

  // Clear optimistic state + org-switch loading once the real activeOrganization has caught up
  React.useEffect(() => {
    if (pendingOrgId && activeOrganization?.id === pendingOrgId) {
      setPendingOrgId(null);
      setOrgSwitching(false); // signals NavigationLoader to dismiss the skeleton
    }
  }, [activeOrganization?.id, pendingOrgId, setOrgSwitching]);

  const handleSwitchOrg = useCallback((organizationId: string) => {
    if (!activeOrganization) return;
    if (organizationId === activeOrganization.id) return;
    if (pendingOrgId === organizationId) return;

    setPendingOrgId(organizationId);
    fetchPermissions(organizationId);
    setOrgSwitching(true);

    authClient.organization.setActive({ organizationId }).then(() => {
      // After setActive, the proxy's atomListeners automatically toggle $activeOrgSignal
      // (10 ms setTimeout in proxy.mjs), which triggers useActiveOrganization to refetch.
      // A manual refetchActive() here would create a second concurrent request — omitted.
      //
      // router.replace triggers loading.tsx + re-renders server components with the
      // new active org session. router.refresh() bypasses Suspense boundaries entirely
      // and never shows the loading skeleton.
      const url = window.location.pathname + window.location.search;
      router.replace(url);
    }).catch((err) => {
      console.error("Failed to switch organization", err);
      clearPermissions();
      setPendingOrgId(null);
      setOrgSwitching(false);
    });
  }, [activeOrganization, pendingOrgId, router, fetchPermissions, clearPermissions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      const num = parseInt(e.key, 10);
      if (isNaN(num) || num < 1 || num > 9) return;
      const org = organizationList?.[num - 1];
      if (!org) return;
      e.preventDefault();
      handleSwitchOrg(org.id);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [organizationList, handleSwitchOrg]);

  // ✅ Conditional returns only after ALL hooks
  //
  // Advance the bootstrap guard synchronously during render (valid: monotonic
  // false→true, refs don't cause re-renders).
  if (organizationList && activeOrganization) {
    hasBootstrappedRef.current = true;
  }

  const hasData = !!organizationList && !!activeOrganization;
  if (!hasBootstrappedRef.current && !hasData && (isListPending || isActivePending)) {
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

  // Only show "Setting up..." on first arrival (never had an org yet).
  // If we previously had an org and it's momentarily null during a background
  // refetch, fall through to render with the last displayOrg instead of
  // flashing the spinner.
  if (!activeOrganization && !hasEverHadOrgRef.current) {
    return (
      <SidebarMenu>
        <SidebarMenuButton size="lg">
          <Spinner /> Setting up...
        </SidebarMenuButton>
      </SidebarMenu>
    );
  }

  // Optimistic display — show the pending org immediately while setActive runs.
  // Fall back to organizationList[0] when activeOrganization is transiently null
  // during a background refetch (we've been here before, so pick the last known entry).
  const fallbackOrg = organizationList?.find((o) => o.id === activeOrganization?.id)
    ?? organizationList?.[0]
    ?? activeOrganization;
  const displayOrg = pendingOrgId
    ? (organizationList?.find((o) => o.id === pendingOrgId) ?? activeOrganization ?? fallbackOrg)
    : (activeOrganization ?? fallbackOrg);

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
