import { AppSidebar } from "@/components/app-sidebar";
import { DashboardBreadcrumb } from "@/components/dashboard-breadcrumb";
import { NotificationCenter } from "@/components/notification-center";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { getCurrentUser } from "@/server/users";
import Image from "next/image";
import { redirect } from "next/navigation";
import authLogo from "@/branding/authlogo.svg";
// import { getOrganizations } from "@/server/organizations";
// import { getCurrentUser } from "@/server/users";

// import { unauthorized } from "next/navigation";
// import { Suspense } from "react";
// import Loading from "./loading";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/auth/login");
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-13 shrink-0 items-center border-b border-border/60 bg-background/95 backdrop-blur-sm transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4 flex-1 min-w-0">
            <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
            <Separator
              orientation="vertical"
              className="mr-1 data-vertical:h-4 data-vertical:self-auto opacity-50"
            />
            <DashboardBreadcrumb />
            <div className="ml-auto flex items-center gap-2">
              <NotificationCenter />
              <Image src={authLogo} width={64} height={32} alt="logo" className="opacity-75 dark:opacity-60" />
            </div>
          </div>
        </header>
        <div className="flex flex-1 flex-col min-h-0">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
