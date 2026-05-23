"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { navConfig } from "@/lib/nav";
import React from "react";

function buildCrumbs(pathname: string) {
  const crumbs: { label: string; href: string }[] = [
    { label: "Dashboard", href: "/dashboard" },
  ];

  for (const group of navConfig) {
    for (const item of group.items) {
      if (pathname === item.url || pathname.startsWith(item.url + "/")) {
        if (item.url !== "/dashboard") {
          crumbs.push({ label: group.title, href: "#" });
          crumbs.push({ label: item.title, href: item.url });
        }
        // Handle sub-routes (e.g. /dashboard/sales/quotation/123)
        if (pathname !== item.url && pathname.startsWith(item.url + "/")) {
          const extra = pathname.slice(item.url.length + 1).split("/")[0];
          const label =
            extra === "new" || extra === "create"
              ? "New"
              : extra === "edit"
              ? "Edit"
              : null;
          if (label) crumbs.push({ label, href: pathname });
        }
        return crumbs;
      }
    }
  }

  return crumbs;
}

export function DashboardBreadcrumb() {
  const pathname = usePathname();
  const crumbs = buildCrumbs(pathname);

  if (crumbs.length <= 1) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <React.Fragment key={crumb.href + i}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : crumb.href === "#" ? (
                  <span className="text-muted-foreground text-sm">{crumb.label}</span>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
