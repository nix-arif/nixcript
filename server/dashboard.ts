"use server";

import { db } from "@/db";
import {
  customerPurchaseOrder,
  salesOrder,
  quotation,
  consignment,
  invoice,
} from "@/db/schema";
import { getCachedSession } from "@/lib/auth/cached-session";
import { getUserPermissions } from "@/lib/permissions/get-user-permissions";
import { hasAccess } from "@/lib/permissions/has-access";
import { eq, and, desc, isNull, inArray, sql, gte } from "drizzle-orm";

async function getSession() {
  const session = await getCachedSession();
  if (!session?.session?.activeOrganizationId) throw new Error("Unauthorized");
  return { orgId: session.session.activeOrganizationId, userId: session.user.id };
}

export interface DashboardCpoRow {
  id: string;
  customerPoNo: string;
  customerName: string | null;
  customerOrg: string | null;
  amount: string;
  status: string;
  salesOrderId: string | null;
  salesOrderNo: string | null;
  createdAt: Date;
}

export interface DashboardSoRow {
  id: string;
  soNo: string;
  customerName: string | null;
  customerOrg: string | null;
  grandTotal: string | null;
  status: string;
  createdAt: Date;
}

export interface DashboardQtRow {
  id: string;
  quotationNo: string;
  customerName: string | null;
  customerOrg: string | null;
  status: string;
  createdAt: Date;
}

export interface DashboardSummary {
  // Open tasks
  openCpos: DashboardCpoRow[];        // CPOs with no SO yet
  pendingSoApprovals: DashboardSoRow[]; // SOs submitted awaiting approval
  pendingQtApprovals: DashboardQtRow[]; // Quotations submitted awaiting approval

  // KPIs
  kpi: {
    openCpoCount: number;
    activeSoCount: number;             // confirmed
    fulfilledSoCount: number;
    activeConsignmentCount: number;
    openQtCount: number;               // draft quotations in progress
    pendingInvoiceCount: number;
  };

  // Recent activity
  recentCpos: DashboardCpoRow[];
  recentSos: DashboardSoRow[];

  // Permissions snapshot (for conditional UI)
  can: {
    cpo: boolean;
    so: boolean;
    quotation: boolean;
    consignment: boolean;
    invoice: boolean;
  };
}

function cpoSnap(snap: any): { name: string | null; org: string | null } {
  if (!snap) return { name: null, org: null };
  return {
    name: [snap.title, snap.name].filter(Boolean).join(" ") || null,
    org: snap.organizationName ?? null,
  };
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const { orgId, userId } = await getSession();
  const perms = await getUserPermissions(userId, orgId);

  const can = {
    cpo:         hasAccess(perms, "customer-po:read"),
    so:          hasAccess(perms, "sales-order:read"),
    quotation:   hasAccess(perms, "quotation:read"),
    consignment: hasAccess(perms, "sales-order:read"),
    invoice:     hasAccess(perms, "invoice:read"),
  };

  const [cpoRows, soRows, qtRows, consignmentRows, invoiceRows] = await Promise.all([
    can.cpo
      ? db
          .select()
          .from(customerPurchaseOrder)
          .where(eq(customerPurchaseOrder.organizationId, orgId))
          .orderBy(desc(customerPurchaseOrder.createdAt))
          .limit(100)
      : Promise.resolve([] as typeof customerPurchaseOrder.$inferSelect[]),

    can.so
      ? db
          .select()
          .from(salesOrder)
          .where(eq(salesOrder.organizationId, orgId))
          .orderBy(desc(salesOrder.createdAt))
          .limit(100)
      : Promise.resolve([] as typeof salesOrder.$inferSelect[]),

    can.quotation
      ? db
          .select()
          .from(quotation)
          .where(eq(quotation.organizationId, orgId))
          .orderBy(desc(quotation.createdAt))
          .limit(100)
      : Promise.resolve([] as typeof quotation.$inferSelect[]),

    can.consignment
      ? db
          .select({ id: consignment.id, status: consignment.status })
          .from(consignment)
          .where(eq(consignment.organizationId, orgId))
      : Promise.resolve([] as { id: string; status: string }[]),

    can.invoice
      ? db
          .select({ id: invoice.id, status: invoice.status })
          .from(invoice)
          .where(eq(invoice.organizationId, orgId))
      : Promise.resolve([] as { id: string; status: string }[]),
  ]);

  // Map CPO rows
  const mapCpo = (r: typeof customerPurchaseOrder.$inferSelect): DashboardCpoRow => {
    const { name, org } = cpoSnap(r.customerSnapshot);
    return {
      id: r.id,
      customerPoNo: r.customerPoNo,
      customerName: name,
      customerOrg: org,
      amount: r.amount,
      status: r.status,
      salesOrderId: r.salesOrderId,
      salesOrderNo: r.salesOrderNo,
      createdAt: r.createdAt,
    };
  };

  const mapSo = (r: typeof salesOrder.$inferSelect): DashboardSoRow => {
    const { name, org } = cpoSnap(r.customerSnapshot);
    return {
      id: r.id,
      soNo: r.soNo,
      customerName: name,
      customerOrg: org,
      grandTotal: r.grandTotal,
      status: r.status,
      createdAt: r.createdAt,
    };
  };

  const mapQt = (r: typeof quotation.$inferSelect): DashboardQtRow => {
    const snap = r.customerSnapshot as any;
    return {
      id: r.id,
      quotationNo: r.quotationNo,
      customerName: snap ? [snap.title, snap.name].filter(Boolean).join(" ") || null : null,
      customerOrg: snap?.organizationName ?? null,
      status: r.status,
      createdAt: r.createdAt,
    };
  };

  const openCpos = cpoRows
    .filter((r) => !r.salesOrderId && r.status !== "cancelled" && r.status !== "fulfilled")
    .map(mapCpo);

  const pendingSoApprovals = soRows
    .filter((r) => r.status === "submitted")
    .map(mapSo);

  // Quotations don't have an approval workflow — show draft ones as "in progress"
  const pendingQtApprovals = qtRows
    .filter((r) => r.status === "draft")
    .slice(0, 10)
    .map(mapQt);

  const recentCpos = cpoRows.slice(0, 8).map(mapCpo);
  const recentSos = soRows.slice(0, 8).map(mapSo);

  const kpi = {
    openCpoCount: openCpos.length,
    activeSoCount: soRows.filter((r) => r.status === "confirmed").length,
    fulfilledSoCount: soRows.filter((r) => r.status === "fulfilled").length,
    activeConsignmentCount: consignmentRows.filter((r) => r.status === "active").length,
    openQtCount: qtRows.filter((r) => r.status === "draft").length,
    pendingInvoiceCount: invoiceRows.filter((r) => r.status === "issued").length,
  };

  return {
    openCpos,
    pendingSoApprovals,
    pendingQtApprovals,
    kpi,
    recentCpos,
    recentSos,
    can,
  };
}
