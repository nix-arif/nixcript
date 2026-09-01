import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  integer,
  date,
  json,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/* =========================
   USER
========================= */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),

  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
});

export type User = typeof user.$inferSelect;

/* =========================
   SESSION
========================= */
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),

    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),

    activeOrganizationId: text("active_organization_id"),
    activeTeamId: text("active_team_id"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),

    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),

    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),

    scope: text("scope"),
    password: text("password"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

/* =========================
   VERIFICATION (Better Auth)
========================= */
export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),

    expiresAt: timestamp("expires_at").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/* =========================
   DEPARTMENT
========================= */
export const department = pgTable(
  "department",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("department_organizationId_idx").on(table.organizationId),
    uniqueIndex("department_org_name_unique").on(table.organizationId, table.name),
  ],
);

/* =========================
   ORGANIZATION
========================= */
export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),

    createdAt: timestamp("created_at").notNull(),
    metadata: text("metadata"),
  },
  (table) => [
    uniqueIndex("organization_slug_uidx").on(table.slug),
    uniqueIndex("organization_name_uidx").on(table.name),
  ],
);

/* =========================
   ORGANIZATION ROLE
========================= */
export const organizationRole = pgTable("organization_role", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  // Better Auth JSON permission (stringified)
  permission: text("permission").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/* =========================
   MEMBER
========================= */
export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // "owner" | "stakeholder" | "member"
    // "member" means the user has dept assignments in member_department
    role: text("role").default("member").notNull(),
    departmentId: text("department_id"), // kept for compat; member_department is authoritative
    // Actual employment start date — set by HR (leave:manage) on the Leave
    // Balances page, never self-editable. Drives leave entitlement service-
    // years and join-year proration; falls back to createdAt when unset.
    hireDate: date("hire_date"),
    // Resignation tendered date — set by HR alongside profile.employmentStatus
    // ("resigned"). Paired with leaveBlockedOnNotice below to control whether
    // this specific member can still apply for leave types flagged
    // blockedDuringNotice (normally Annual Leave) during their notice period.
    // Case-by-case per member rather than a blanket policy, since notice-
    // period leave handling is commonly negotiated per resignation.
    noticeDate: date("notice_date"),
    leaveBlockedOnNotice: boolean("leave_blocked_on_notice").notNull().default(true),
    createdAt: timestamp("created_at").notNull(),
    // Soft-delete: set when member is removed, null when active
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by").references(() => user.id),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    // Better Auth role on the member record ("owner" | "stakeholder" | "member")
    role: text("role"),
    // The initial department assigned on invite
    departmentId: text("department_id"),
    // The role within that department ("manager" | "member")
    departmentRole: text("department_role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    teamId: text("team_id"),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

/* =========================
   MEMBER DEPARTMENT
   Junction: one member can belong to many departments,
   each with its own role ("manager" | "member").
========================= */
export const memberDepartment = pgTable(
  "member_department",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    departmentId: text("department_id")
      .notNull()
      .references(() => department.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(), // "manager" | "member"
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("member_department_unique").on(table.memberId, table.departmentId),
    index("member_department_memberId_idx").on(table.memberId),
    index("member_department_orgId_idx").on(table.organizationId),
  ],
);

// A member-invite request from anyone other than the owner. Nothing is sent
// yet — no Better Auth invitation row exists, no email goes out — until the
// owner approves it (approvePendingInvitation in server/member-approvals.ts),
// at which point the real invitation is created for the first time. This is
// deliberately a separate table rather than a status on `invitation` itself:
// `invitation` is Better Auth's own table (its accept-invitation flow creates
// the member the moment the row exists), so staging the request anywhere
// inside it would mean the invite could be accepted before anyone approved it.
export const pendingInvitation = pgTable(
  "pending_invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(), // "manager" | "member" | "stakeholder" (UI role)
    departmentId: text("department_id").references(() => department.id, { onDelete: "set null" }),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | REJECTED
    reviewedBy: text("reviewed_by").references(() => user.id),
    reviewedAt: timestamp("reviewed_at"),
    reviewComment: text("review_comment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("pending_invitation_org_idx").on(table.organizationId),
    index("pending_invitation_status_idx").on(table.status, table.organizationId),
  ],
);

// A request to add an EXISTING member to a department (with a dept role)
// from anyone other than the owner. Same reasoning as pendingInvitation:
// grantDepartmentPermissions() only runs once the owner approves, so the
// member gains nothing from the request itself.
export const pendingDepartmentAssignment = pgTable(
  "pending_department_assignment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    departmentId: text("department_id")
      .notNull()
      .references(() => department.id, { onDelete: "cascade" }),
    departmentRole: text("department_role").notNull(), // "manager" | "member"
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | REJECTED
    reviewedBy: text("reviewed_by").references(() => user.id),
    reviewedAt: timestamp("reviewed_at"),
    reviewComment: text("review_comment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("pending_dept_assignment_org_idx").on(table.organizationId),
    index("pending_dept_assignment_status_idx").on(table.status, table.organizationId),
  ],
);

/* =========================
   TEAM
========================= */
export const team = pgTable(
  "team",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("team_organizationId_idx").on(table.organizationId)],
);

/* =========================
   TEAM MEMBER
========================= */
export const teamMember = pgTable(
  "team_member",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("team_member_teamId_idx").on(table.teamId),
    index("team_member_userId_idx").on(table.userId),
  ],
);

/* =========================
   CUSTOM SCHEMA
========================= */

export const permission = pgTable("permission", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userPermission = pgTable(
  "user_permission",
  {
    id: text("id").primaryKey(),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    permissionKey: text("permission_key").notNull(), // "project.create"

    allowed: boolean("allowed").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("user_permission_user_idx").on(table.userId),
    index("user_permission_org_idx").on(table.organizationId),

    // prevent duplicate override
    uniqueIndex("user_permission_unique").on(
      table.userId,
      table.organizationId,
      table.permissionKey,
    ),
  ],
);

// Per-org override of whether a given approval-type permission key allows
// the record owner to act on their own submission (e.g. approve their own
// claim). Absence of a row for an org+key means "use the hardcoded default"
// in lib/approvals/constants.ts — only an explicit admin change ever
// inserts a row here.
export const approvalSetting = pgTable(
  "approval_setting",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(), // e.g. "claim:approve"
    selfActionAllowed: boolean("self_action_allowed").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("approval_setting_org_idx").on(table.organizationId),
    uniqueIndex("approval_setting_org_key_uidx").on(table.organizationId, table.permissionKey),
  ],
);

// The set of permission keys an org has designated as a default baseline —
// granted to every current member when checked (via /dashboard/admin/default-permissions)
// and to every future member automatically at invite-accept time. Presence
// of a row means "checked"; unchecking deletes the row. Unchecking never
// retroactively revokes the permission from members who already have it —
// see lib/permissions/grant-defaults.ts.
export const orgDefaultPermission = pgTable(
  "org_default_permission",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("org_default_permission_org_idx").on(table.organizationId),
    uniqueIndex("org_default_permission_org_key_uidx").on(table.organizationId, table.permissionKey),
  ],
);

// Permission keys an org has flagged as sensitive (e.g. Delete Supplier,
// Remove Members) on /dashboard/admin/default-permissions. Purely a UI/UX
// gate: turning a flagged permission ON as a default requires the acting
// admin to re-enter their account password first (see setSensitiveDefaultPermission
// in server/default-permissions.ts). Turning it off, and marking/unmarking
// the flag itself, need no password — only granting a sensitive permission does.
export const sensitivePermission = pgTable(
  "sensitive_permission",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("sensitive_permission_org_idx").on(table.organizationId),
    uniqueIndex("sensitive_permission_org_key_uidx").on(table.organizationId, table.permissionKey),
  ],
);

/* =========================
   RELATIONS
========================= */
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  members: many(member),
  invitations: many(invitation),
  userPermissions: many(userPermission),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
  organizationRoles: many(organizationRole),
  userPermissions: many(userPermission),
}));

export const organizationRoleRelations = relations(
  organizationRole,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationRole.organizationId],
      references: [organization.id],
    }),
  }),
);

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export const permissionRelations = relations(permission, ({ many }) => ({
  userPermissions: many(userPermission),
}));

export const userPermissionRelations = relations(userPermission, ({ one }) => ({
  user: one(user, {
    fields: [userPermission.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [userPermission.organizationId],
    references: [organization.id],
  }),
}));

export const teamRelations = relations(team, ({ one, many }) => ({
  organization: one(organization, {
    fields: [team.organizationId],
    references: [organization.id],
  }),
  members: many(teamMember),
}));

export const teamMemberRelations = relations(teamMember, ({ one }) => ({
  team: one(team, {
    fields: [teamMember.teamId],
    references: [team.id],
  }),
  user: one(user, {
    fields: [teamMember.userId],
    references: [user.id],
  }),
}));

/* ============================================================================================================================================================================================================================================
   BETTER-AUTH ENDS HERE
=============================================================================================================================================================================================================================================== */

export const profile = pgTable("profile", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),

  // Personal
  fullname: text("fullname"),
  icNumber: text("ic_number"),
  taxNo: text("tax_no"), // TIN No.
  epfNo: text("epf_no"),
  socsoNo: text("socso_no"),
  dateOfBirth: date("date_of_birth"),
  gender: text("gender"), // male | female
  nationality: text("nationality"),
  race: text("race"),
  maritalStatus: text("marital_status"), // single | married | divorced | widowed

  // Contact
  mailingAddress: text("mailing_address"),
  permanentAddress: text("permanent_address"),
  phoneNumbers: json("phone_numbers").$type<string[]>().default([]),
  personalEmail: text("personal_email"),

  // Emergency Contact 1
  emergencyName1: text("emergency_name1"),
  emergencyRelationship1: text("emergency_relationship1"),
  emergencyPhone1: text("emergency_phone1"),
  emergencyAddress1: text("emergency_address1"),

  // Emergency Contact 2
  emergencyName2: text("emergency_name2"),
  emergencyRelationship2: text("emergency_relationship2"),
  emergencyPhone2: text("emergency_phone2"),
  emergencyAddress2: text("emergency_address2"),

  // Banking
  bankName: text("bank_name"),
  bankAccountNo: text("bank_account_no"),
  bankAccountHolder: text("bank_account_holder"),
  bankBookUrl: text("bank_book_url"), // R2 key

  // Employment
  jobTitle: text("job_title"),
  department: text("department"),
  employmentType: text("employment_type"), // full-time | part-time
  employmentStatus: text("employment_status"), // probation | permanent

  // Education
  educationLevel: text("education_level"), // spm | diploma | sijil | degree | master | phd
  fieldOfStudy: text("field_of_study"),

  // PDPA
  pdpaConsent: boolean("pdpa_consent").default(false).notNull(),
  pdpaConsentAt: timestamp("pdpa_consent_at"),

  // System
  organizationId: text("organization_id").references(() => organization.id, {
    onDelete: "set null",
  }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const profileRelations = relations(profile, ({ one }) => ({
  user: one(user, {
    fields: [profile.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [profile.organizationId],
    references: [organization.id],
  }),
}));

export const product = pgTable(
  "product",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Product details
    productCode: text("product_code").notNull(),
    description: text("description"),
    sellingUnitPrice: text("selling_unit_price"),
    sellingPriceCurrency: text("selling_price_currency").notNull().default("MYR"),
    costUnitPrice: text("cost_unit_price"),
    costPriceCurrency: text("cost_price_currency"),
    uom: text("uom"),
    supplier: text("supplier"),
    brand: text("brand"),

    // Rental flag
    isRental: boolean("is_rental").default(false).notNull(),

    // Sourcing: trading | oem | both (null = inherit org's businessType default).
    // "both" means this product swings either way per order — SO items must
    // pick one explicitly rather than silently inheriting it.
    sourcingType: text("sourcing_type"),
    // OEM / private-label spec — only meaningful when sourcingType is oem/both.
    designBrandName: text("design_brand_name"), // reference brand to match spec against, e.g. "geister"
    designBrandCode: text("design_brand_code"), // reference catalog code, e.g. "10-3620"
    privateLabelCode: text("private_label_code"), // own code to emboss, e.g. "F680-18DP"
    embossRequired: boolean("emboss_required").default(false).notNull(),
    qrCodeRequired: boolean("qr_code_required").default(false).notNull(),

    // Image
    imageKey: text("image_key"), // R2 key for product catalogue image
    imageUploadedAt: timestamp("image_uploaded_at"), // bumped on every image upload for cache-busting

    // Certificate
    mdaRegistrationNo: text("mda_registration_no"),
    mdaPageNo: text("mda_page_no"),
    mdaValidFrom: timestamp("mda_valid_from", { mode: "string" }),
    mdaExpiredOn: timestamp("mda_expired_on", { mode: "string" }),
    mdaPdfFile: text("mda_pdf_file"),

    // Coordinates
    mdaMatchX: text("mda_match_x"),
    mdaMatchY: text("mda_match_y"),
    mdaRowHeight: text("mda_row_height"),
    mdaPageWidth: text("mda_page_width"),
    mdaPageHeight: text("mda_page_height"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("product_code_org_uidx").on(
      table.productCode,
      table.organizationId,
    ),
    index("product_org_idx").on(table.organizationId),
  ],
);

export const productRelations = relations(product, ({ one }) => ({
  organization: one(organization, {
    fields: [product.organizationId],
    references: [organization.id],
  }),
}));

/* =========================
   INVENTORY
========================= */

export const stockLevel = pgTable(
  "stock_level",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    warehouseLabel: text("warehouse_label").notNull().default("Default"),
    quantity: text("quantity").notNull().default("0"),
    reservedQty: text("reserved_qty").notNull().default("0"),
    unitCost: text("unit_cost"),
    reorderPoint: text("reorder_point"),
    maxStock: text("max_stock"),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("stock_level_product_wh_uidx").on(t.productId, t.organizationId, t.warehouseLabel),
    index("stock_level_org_idx").on(t.organizationId),
    index("stock_level_wh_idx").on(t.organizationId, t.warehouseLabel),
  ],
);

export const stockMovement = pgTable(
  "stock_movement",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    productCode: text("product_code").notNull(),
    warehouseLabel: text("warehouse_label").notNull().default("Default"),
    warehouseTo: text("warehouse_to"),      // only for TRANSFER movements
    // STOCK_IN | STOCK_OUT | ADJUSTMENT | RETURN | OPENING | TRANSFER
    movementType: text("movement_type").notNull(),
    quantity: text("quantity").notNull(),   // signed: positive = in, negative = out
    balanceAfter: text("balance_after"),    // set at approval time
    unitCost: text("unit_cost"),
    // PURCHASE_ORDER | SALES_ORDER | DELIVERY_ORDER | MANUAL
    referenceType: text("reference_type").notNull().default("MANUAL"),
    referenceId: text("reference_id"),
    referenceNo: text("reference_no"),
    notes: text("notes"),
    serialNo: text("serial_no"),
    lotNo: text("lot_no"),
    expiryDate: timestamp("expiry_date"),
    lotId: text("lot_id"),   // FK to stock_lot — populated at approval time
    // PENDING | APPROVED | REJECTED
    status: text("status").notNull().default("PENDING"),
    reviewedBy: text("reviewed_by").references(() => user.id),
    reviewedAt: timestamp("reviewed_at"),
    reviewComment: text("review_comment"),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("stock_movement_product_idx").on(t.productId, t.organizationId),
    index("stock_movement_type_idx").on(t.movementType),
    index("stock_movement_org_idx").on(t.organizationId),
    index("stock_movement_created_idx").on(t.createdAt),
  ],
);

export const stockLevelRelations = relations(stockLevel, ({ one }) => ({
  organization: one(organization, { fields: [stockLevel.organizationId], references: [organization.id] }),
  product: one(product, { fields: [stockLevel.productId], references: [product.id] }),
}));

export const stockMovementRelations = relations(stockMovement, ({ one }) => ({
  organization: one(organization, { fields: [stockMovement.organizationId], references: [organization.id] }),
  product: one(product, { fields: [stockMovement.productId], references: [product.id] }),
  createdByUser: one(user, { fields: [stockMovement.createdBy], references: [user.id] }),
}));

// ── Stock lots (per-lot tracking) ────────────────────────────────────────

export const stockLot = pgTable(
  "stock_lot",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    warehouseLabel: text("warehouse_label").notNull().default("Default"),
    lotNo: text("lot_no").notNull(),
    expiryDate: timestamp("expiry_date"),
    quantity: text("quantity").notNull().default("0"),
    reservedQty: text("reserved_qty").notNull().default("0"),
    unitCost: text("unit_cost"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("stock_lot_product_wh_lot_uidx").on(t.productId, t.organizationId, t.warehouseLabel, t.lotNo),
    index("stock_lot_org_idx").on(t.organizationId),
    index("stock_lot_expiry_idx").on(t.expiryDate),
  ],
);

export const stockLotRelations = relations(stockLot, ({ one }) => ({
  organization: one(organization, { fields: [stockLot.organizationId], references: [organization.id] }),
  product: one(product, { fields: [stockLot.productId], references: [product.id] }),
}));

// ── Staff stock requests ──────────────────────────────────────────────────

export const stockRequest = pgTable(
  "stock_request",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by").notNull().references(() => user.id),
    productId: text("product_id").notNull().references(() => product.id),
    productCode: text("product_code").notNull(),
    warehouseFrom: text("warehouse_from").notNull().default("Default"),
    qty: text("qty").notNull(),
    notes: text("notes"),
    // pending | approved | rejected | fulfilled
    status: text("status").notNull().default("pending"),
    approvedBy: text("approved_by").references(() => user.id),
    approvedQty: text("approved_qty"),
    approvedAt: timestamp("approved_at"),
    approvedNotes: text("approved_notes"),
    fulfilledAt: timestamp("fulfilled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("stock_request_org_idx").on(t.organizationId),
    index("stock_request_user_idx").on(t.requestedBy, t.organizationId),
    index("stock_request_status_idx").on(t.status, t.organizationId),
  ],
);

export const staffStockLimit = pgTable(
  "staff_stock_limit",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id),
    productId: text("product_id").notNull().references(() => product.id),
    maxQty: text("max_qty").notNull(),
    setBy: text("set_by").notNull().references(() => user.id),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("staff_stock_limit_uidx").on(t.organizationId, t.userId, t.productId),
    index("staff_stock_limit_org_idx").on(t.organizationId),
  ],
);

export const stockRequestRelations = relations(stockRequest, ({ one }) => ({
  organization: one(organization, { fields: [stockRequest.organizationId], references: [organization.id] }),
  requestedByUser: one(user, { fields: [stockRequest.requestedBy], references: [user.id] }),
  product: one(product, { fields: [stockRequest.productId], references: [product.id] }),
}));

export const staffStockLimitRelations = relations(staffStockLimit, ({ one }) => ({
  organization: one(organization, { fields: [staffStockLimit.organizationId], references: [organization.id] }),
  user: one(user, { fields: [staffStockLimit.userId], references: [user.id] }),
  product: one(product, { fields: [staffStockLimit.productId], references: [product.id] }),
}));

export const organizationProfile = pgTable("organization_profile", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),

  // SSM
  oldSsmNo: text("old_ssm_no"),
  newSsmNo: text("new_ssm_no"),
  ssmCertUrl: text("ssm_cert_url"), // R2 key

  // Company info
  companyName: text("company_name"),
  taxNo: text("tax_no"), // TIN No.
  taxCertUrl: text("tax_cert_url"), // R2 key
  companyAddress: text("company_address"),

  // Warehouse addresses — list
  warehouseAddresses: json("warehouse_addresses")
    .$type<{ label: string; address: string }[]>()
    .default([]),

  // MOF
  mofNo: text("mof_no"),
  mofValidity: timestamp("mof_validity", { mode: "string" }),
  mofCertUrl: text("mof_cert_url"), // R2 key

  // PKK
  pkkNo: text("pkk_no"),
  pkkCertUrl: text("pkk_cert_url"), // R2 key

  // Branding
  logoKey: text("logo_key"), // R2 key for company logo
  brandColor: text("brand_color"), // hex e.g. "#1a56db"
  slateTextColor: text("slate_text_color"),    // slate: text accent colour (labels, codes, headers)
  slateHeadingColor: text("slate_heading_color"), // slate: company name + QUOTATION label colour
  slateInfoFontSize: text("slate_info_font_size"), // slate: info section font size (small | normal | large)
  templateStyle: text("template_style").default("corporate"), // corporate | modern | bold

  // PDF download template: affirma | nexus | slate
  pdfTemplate: text("pdf_template").default("affirma"),
  titlePosition: text("title_position").default("stamp"), // stamp | table-banner
  tableFontSize: text("table_font_size").default("normal"), // small | normal | large

  // Header customisation
  headerLayout: text("header_layout").default("standard"), // standard | logo-top | centered | text-only
  orgNameSize: text("org_name_size").default("medium"), // small | medium | large | xlarge
  orgNameBold: integer("org_name_bold").default(1),
  orgNameUppercase: integer("org_name_uppercase").default(0),
  orgInfoSide: text("org_info_side").default("left"), // left | right — which side the org info panel is on
  quotationLabelSize: text("quotation_label_size").default("normal"), // small | normal | large
  quotationLabelBold: integer("quotation_label_bold").default(1),
  quotationLabelUppercase: integer("quotation_label_uppercase").default(1),
  quotationLabelAlign: text("quotation_label_align").default("right"), // left | center | right

  // Table style
  tableRowStyle: text("table_row_style").default("default"), // default | simple | rounded
  showCodeColumn: integer("show_code_column").default(1),

  // Quotation number format: A | B | C
  quotationNoFormat: text("quotation_no_format").default("A"),

  // Business model: trading | oem | both — governs whether products/SO items
  // expose OEM sourcing (design reference + private-label emboss spec).
  businessType: text("business_type").default("trading"),

  // Phone / Contact
  phone: text("phone"),
  email: text("email"),
  website: text("website"),

  // MDA
  mdaEstablishmentNo: text("mda_establishment_no"),
  mdaEstablishmentValidity: timestamp("mda_establishment_validity", {
    mode: "string",
  }),
  mdaCertUrl: text("mda_cert_url"),

  // Attention block style (customer info section)
  attentionNameSize: text("attention_name_size").default("medium"), // small | medium | large | xlarge
  attentionNameBold: integer("attention_name_bold").default(1),

  // Quotation detail block style (right-side info section)
  detailFontSize: text("detail_font_size").default("normal"), // small | normal | large
  detailFontBold: integer("detail_font_bold").default(0),
  detailAlignment: text("detail_alignment").default("right"), // left | right

  // Bank statement
  bankStatementUrl: text("bank_statement_url"),

  // Lampiran
  lampiran12Url: text("lampiran12_url"),
  lampiran13Url: text("lampiran13_url"),

  // Banking
  bankingInfo: json("banking_info")
    .$type<
      {
        id: string;
        bankName: string;
        branchName: string;
        accountHolder: string;
        accountNo: string;
        accountType: string;
        swiftCode: string;
        isPrimary: boolean;
      }[]
    >()
    .default([]),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const organizationProfileRelations = relations(
  organizationProfile,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationProfile.organizationId],
      references: [organization.id],
    }),
  }),
);

export const customer = pgTable(
  "customer",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title"), // Dr, Mr, Ms, Mdm, Prof
    name: text("name").notNull(),
    organizationName: text("organization_name"),
    organizationAddress: text("organization_address"),
    position: text("position"), // ← rename from department
    department: text("department"), // ← keep as separate field
    contactNo: text("contact_no"), // ← add
    email: text("email"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("customer_org_idx").on(t.organizationId)],
);

export const customerRelations = relations(customer, ({ one, many }) => ({
  organization: one(organization, {
    fields: [customer.organizationId],
    references: [organization.id],
  }),
  createdByUser: one(user, {
    fields: [customer.createdBy],
    references: [user.id],
  }),
  companies: many(customerCompany),
}));

// ── Many-to-many: customer ↔ shared org entity ──────────────────────────────

export const customerOrganization = pgTable(
  "customer_organization",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    email: text("email"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("customer_organization_org_idx").on(t.organizationId),
    uniqueIndex("customer_organization_name_uidx").on(t.organizationId, t.name),
  ],
);

export const customerOrganizationRelations = relations(customerOrganization, ({ one, many }) => ({
  organization: one(organization, {
    fields: [customerOrganization.organizationId],
    references: [organization.id],
  }),
  companies: many(customerCompany),
}));

export const customerCompany = pgTable(
  "customer_company",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    customerOrganizationId: text("customer_organization_id")
      .references(() => customerOrganization.id, { onDelete: "set null" }),
    position: text("position"),
    department: text("department"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("customer_company_customer_idx").on(t.customerId)],
);

export const customerCompanyRelations = relations(customerCompany, ({ one }) => ({
  customer: one(customer, {
    fields: [customerCompany.customerId],
    references: [customer.id],
  }),
  organization: one(customerOrganization, {
    fields: [customerCompany.customerOrganizationId],
    references: [customerOrganization.id],
  }),
}));

/* ============================================================================================================================================================================================================================================
   QUOTATION TABLE
=============================================================================================================================================================================================================================================== */

export type PaymentOption =
  | { type: "lump_sum";   label: string; discountPct?: number; note?: string }
  | { type: "instalment"; label: string; deposit: string; monthly: string; months: number; lastMonth?: string; note?: string };

// ── Quotation ──────────────────────────────────────────────────────────────
export const quotation = pgTable(
  "quotation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Running number
    quotationNo: text("quotation_no").notNull(), // e.g. BMS-QT-2025-0001

    // Mode
    mode: text("mode").notNull().default("single"), // single | comparison

    // Comparison group — shared across all quotations created together
    groupId: text("group_id"),
    isDummy: integer("is_dummy").notNull().default(0), // 1 = dummy (non-active org)

    // Customer
    customerId: text("customer_id").references(() => customer.id),
    customerSnapshot: json("customer_snapshot").$type<{
      title?: string;
      name: string;
      position?: string;
      department?: string;
      email?: string;
      contactNo?: string;
      organizationName?: string;
      organizationAddress?: string;
    }>(),

    // Sales metadata
    salesPersonId: text("sales_person_id").references(() => user.id),
    salesPersonName: text("sales_person_name"),
    associateSalesPersons: json("associate_sales_persons").$type<{ id: string; name: string }[]>(),
    preparedById: text("prepared_by_id").references(() => user.id),
    preparedByName: text("prepared_by_name"),
    validUntil: timestamp("valid_until"),
    notes: text("notes"),
    deliveryTerm: text("delivery_term"),
    paymentTerm: text("payment_term"),
    returnPolicy: text("return_policy"),
    warranty: text("warranty"),
    paymentOptions: json("payment_options").$type<PaymentOption[]>(),

    // Pricing
    subtotal: text("subtotal").notNull().default("0"),
    overallDiscountPct: text("overall_discount_pct").default("0"),
    overallDiscountAmt: text("overall_discount_amt").default("0"),
    sst: text("sst").default("0"),
    sstPct: text("sst_pct").default("0"),
    grandTotal: text("grand_total").notNull().default("0"),

    // Options
    includeCatalogue: integer("include_catalogue").notNull().default(1),
    includeMdaCerts: integer("include_mda_certs").notNull().default(1),
    showUnitPrice: integer("show_unit_price").notNull().default(1), // kept for compat, always true
    showTotalPrice: integer("show_total_price").notNull().default(1),
    showItemizeDiscount: integer("show_itemize_discount").notNull().default(0),
    showProductCode: integer("show_product_code").notNull().default(1),
    showItemizedPricing: integer("show_itemized_pricing").notNull().default(1),

    // Attached documents
    inclMof: integer("incl_mof").notNull().default(1),
    inclSsm: integer("incl_ssm").notNull().default(1),
    inclTcc: integer("incl_tcc").notNull().default(1),
    inclBankStatement: integer("incl_bank_statement").notNull().default(1),
    inclMdaEstablishment: integer("incl_mda_establishment")
      .notNull()
      .default(1),
    inclLampiran12: integer("incl_lampiran12").notNull().default(1),
    inclLampiran13: integer("incl_lampiran13").notNull().default(1),

    // Document
    title: text("title").default("Loose Items"),
    sets: integer("sets").notNull().default(1),

    // Government project batch — links all quotations from one createGovernmentBatch call
    govBatchId: text("gov_batch_id"),

    // Revision tracking
    revisionNo: integer("revision_no").notNull().default(0),
    originalQuotationId: text("original_quotation_id"), // no FK reference to avoid self-ref complexity

    // Status
    status: text("status").notNull().default("draft"), // draft | final

    categoryIds: json("category_ids").$type<string[]>().default([]).notNull(),

    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("quotation_no_org_uidx").on(t.organizationId, t.quotationNo),
    index("quotation_org_idx").on(t.organizationId),
  ],
);

// ── Quotation items ────────────────────────────────────────────────────────
export const quotationItem = pgTable(
  "quotation_item",
  {
    id: text("id").primaryKey(),
    quotationId: text("quotation_id")
      .notNull()
      .references(() => quotation.id, { onDelete: "cascade" }),

    // Spreadsheet row data
    sortOrder: integer("sort_order").notNull().default(0),
    rowNo: text("row_no").notNull(),
    sku: text("sku"),
    productCode: text("product_code"),
    description: text("description"),
    qty: text("qty").notNull().default("1"),
    uom: text("uom"),
    unitPrice: text("unit_price").default("0"),
    discountPct: text("discount_pct").default("0"),
    discountAmt: text("discount_amt").default("0"),
    totalPrice: text("total_price").default("0"),

    // From product DB
    productId: text("product_id"),
    productName: text("product_name"),
    imageKey: text("image_key"), // R2 key for catalogue image
    mdaRegNo: text("mda_reg_no"),
    mdaValidity: text("mda_validity"),
    hasCert: integer("has_cert").default(0),
    hasPrice: integer("has_price").default(0),

    // Source flags — which columns came from spreadsheet vs DB vs user edit
    descriptionSource: text("description_source").default("db"), // db | sheet | user
    priceSource: text("price_source").default("db"), // db | sheet | user
    uomSource: text("uom_source").default("db"), // db | sheet
    discountSource: text("discount_source"),  // user (only set when user edits)
    setQtySource: text("set_qty_source"),     // user (only set when user edits)

    // Sell / rent
    lineType: text("line_type").notNull().default("sell"), // sell | rent
    rentalDuration: text("rental_duration"),               // e.g. "12"
    rentalUnit: text("rental_unit"),                       // day | week | month | year

    // Set grouping
    setGroupId: text("set_group_id"),    // UUID shared by all items in the same set
    setGroupLabel: text("set_group_label"), // e.g. "ICU Package"
    setQty: text("set_qty"),             // how many sets (multiplier), stored per-item

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("quotation_item_quotation_idx").on(t.quotationId)],
);

// ── Quotation running number counter ──────────────────────────────────────
export const quotationCounter = pgTable("quotation_counter", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// Relations
export const quotationRelations = relations(quotation, ({ one, many }) => ({
  organization: one(organization, {
    fields: [quotation.organizationId],
    references: [organization.id],
  }),
  customer: one(customer, {
    fields: [quotation.customerId],
    references: [customer.id],
  }),
  createdByUser: one(user, {
    fields: [quotation.createdBy],
    references: [user.id],
  }),
  salesPerson: one(user, {
    fields: [quotation.salesPersonId],
    references: [user.id],
  }),
  items: many(quotationItem),
}));

export const quotationItemRelations = relations(quotationItem, ({ one }) => ({
  quotation: one(quotation, {
    fields: [quotationItem.quotationId],
    references: [quotation.id],
  }),
}));

/* ============================================================================================================================================================================================================================================
   HUMAN RESOURCES TABLE
=============================================================================================================================================================================================================================================== */
// Payroll period — e.g. "May 2025"
export const payrollPeriod = pgTable(
  "payroll_period",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    month: integer("month").notNull(), // 1-12
    year: integer("year").notNull(),
    label: text("label").notNull(), // "May 2025"
    status: text("status").notNull().default("draft"), // draft | approved | published
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    approvedBy: text("approved_by").references(() => user.id),
    approvedAt: timestamp("approved_at"),
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("payroll_period_month_year_org_uidx").on(
      t.organizationId,
      t.month,
      t.year,
    ),
    index("payroll_period_org_idx").on(t.organizationId),
  ],
);

// Individual payslip per employee per period
export const payslip = pgTable(
  "payslip",
  {
    id: text("id").primaryKey(),
    periodId: text("period_id")
      .notNull()
      .references(() => payrollPeriod.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // Employment snapshot (in case profile changes later)
    employeeName: text("employee_name").notNull(),
    icNumber: text("ic_number"),
    jobTitle: text("job_title"),
    department: text("department"),
    employmentType: text("employment_type"),
    bankName: text("bank_name"),
    bankAccountNo: text("bank_account_no"),
    bankAccountHolder: text("bank_account_holder"),

    // Earnings
    basicSalary: text("basic_salary").notNull(),
    bonus: text("bonus").default("0"),
    overtimePay: text("overtime_pay").default("0"),
    caseAllowancePay: text("case_allowance_pay").default("0"),
    petrolAllowancePay: text("petrol_allowance_pay").default("0"),
    allowances: json("allowances")
      .$type<{ label: string; amount: string }[]>()
      .default([]),

    // Deductions
    epfEmployee: text("epf_employee").default("0"), // 11%
    epfEmployer: text("epf_employer").default("0"), // 13% or 12%
    socsoEmployee: text("socso_employee").default("0"),
    socsoEmployer: text("socso_employer").default("0"),
    eisEmployee: text("eis_employee").default("0"),
    eisEmployer: text("eis_employer").default("0"),
    lhdn: text("lhdn").default("0"), // PCB/MTD
    otherDeductions: json("other_deductions")
      .$type<{ label: string; amount: string }[]>()
      .default([]),

    // Computed totals
    grossPay: text("gross_pay").notNull(),
    totalDeductions: text("total_deductions").notNull(),
    netPay: text("net_pay").notNull(),

    // Status
    status: text("status").notNull().default("draft"), // draft | published
    pdfUrl: text("pdf_url"), // R2 key after PDF is generated

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("payslip_period_user_uidx").on(t.periodId, t.userId),
    index("payslip_user_idx").on(t.userId),
    index("payslip_period_idx").on(t.periodId),
  ],
);

export const payrollPeriodRelations = relations(
  payrollPeriod,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [payrollPeriod.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [payrollPeriod.createdBy],
      references: [user.id],
    }),
    payslips: many(payslip),
  }),
);

export const payslipRelations = relations(payslip, ({ one }) => ({
  period: one(payrollPeriod, {
    fields: [payslip.periodId],
    references: [payrollPeriod.id],
  }),
  user: one(user, { fields: [payslip.userId], references: [user.id] }),
}));

/* ============================================================================================================================================================================================================================================
   SUPPLIER TABLE
=============================================================================================================================================================================================================================================== */

export const supplier = pgTable(
  "supplier",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    registrationNo: text("registration_no"),
    address: text("address"),
    contactPerson: text("contact_person"),
    contactNo: text("contact_no"),
    email: text("email"),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("supplier_org_idx").on(t.organizationId)],
);

export const supplierRelations = relations(supplier, ({ one }) => ({
  organization: one(organization, {
    fields: [supplier.organizationId],
    references: [organization.id],
  }),
  createdByUser: one(user, {
    fields: [supplier.createdBy],
    references: [user.id],
  }),
}));

/* ============================================================================================================================================================================================================================================
   SALES ORDER TABLE
=============================================================================================================================================================================================================================================== */

export const salesOrder = pgTable(
  "sales_order",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    soNo: text("so_no").notNull(), // e.g. BMS-SO-2025-0001

    // Source quotation (optional — SO can be created independently)
    quotationId: text("quotation_id").references(() => quotation.id),
    quotationNo: text("quotation_no"),
    linkedQuotations: json("linked_quotations").$type<{
      id: string;
      quotationNo: string;
      customerId?: string | null;
      customerSnapshot?: {
        title?: string;
        name: string;
        organizationName?: string;
        organizationAddress?: string;
        email?: string;
        contactNo?: string;
      } | null;
    }[]>(),

    // Customer
    customerId: text("customer_id").references(() => customer.id),
    customerSnapshot: json("customer_snapshot").$type<{
      title?: string;
      name: string;
      organizationName?: string;
      organizationAddress?: string;
      position?: string;
      department?: string;
      email?: string;
      contactNo?: string;
    }>(),

    // Supplier PDF quotation (stored in R2 private bucket supplier-quotation)
    supplierQuotationKey: text("supplier_quotation_key"),

    // Sales info
    salesPersonId: text("sales_person_id").references(() => user.id),
    salesPersonName: text("sales_person_name"),
    associateSalesPersons: json("associate_sales_persons").$type<{ id: string; name: string }[]>(),

    // Set groups
    sets: integer("sets").notNull().default(1),

    // Pricing
    subtotal: text("subtotal").notNull().default("0"),
    overallDiscountPct: text("overall_discount_pct").default("0"),
    overallDiscountAmt: text("overall_discount_amt").default("0"),
    sst: text("sst").default("0"),
    sstPct: text("sst_pct").default("0"),
    grandTotal: text("grand_total").notNull().default("0"),

    // Customer PO(s) that triggered this SO
    customerPoId: text("customer_po_id").references((): AnyPgColumn => customerPurchaseOrder.id), // primary (first) for backward compat
    customerPoNo: text("customer_po_no"),
    customerPoLinks: json("customer_po_links").$type<{ customerPoId: string; customerPoNo: string }[]>(),

    notes: text("notes"),
    status: text("status").notNull().default("draft"), // pending-do | pending-pr | submitted | confirmed | fulfilled | cancelled

    deliveryDate: timestamp("delivery_date"),
    deliveryAddress: text("delivery_address"),

    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),

    submittedBy: text("submitted_by").references(() => user.id),
    submittedAt: timestamp("submitted_at"),

    approvedBy: text("approved_by").references(() => user.id),
    approvedAt: timestamp("approved_at"),

    // Order type — standard commercial SO or pro-forma (samples, warranty, replacement)
    soType: text("so_type").notNull().default("standard"), // 'standard' | 'proforma'
    proformaReason: text("proforma_reason"), // 'sample' | 'warranty' | 'replacement' | null

    // Original SO reference — for warranty/replacement pro-forma only
    originalSoId: text("original_so_id").references((): AnyPgColumn => salesOrder.id),
    originalSoNo: text("original_so_no"),

    // Urgent PO-pending authorization — only relevant when soType = 'urgent'
    urgentAuthType: text("urgent_auth_type"),        // 'verbal' | 'email' | 'loi' | 'internal'
    urgentAuthBy: text("urgent_auth_by"),            // customer contact who gave approval
    urgentAuthDate: text("urgent_auth_date"),        // ISO date string of authorization
    urgentPoExpectedBy: text("urgent_po_expected_by"), // ISO date string — CPO deadline
    urgentAuthNotes: text("urgent_auth_notes"),      // free-text notes / reference

    // Stock reservation — set by warehouse after SO is confirmed
    stockReservationStatus: text("stock_reservation_status"), // null | 'reserved' | 'insufficient'
    stockReservedAt: timestamp("stock_reserved_at"),
    stockReservedBy: text("stock_reserved_by").references(() => user.id),

    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("sales_order_no_org_uidx").on(t.organizationId, t.soNo),
    index("sales_order_org_idx").on(t.organizationId),
  ],
);

export const salesOrderItem = pgTable(
  "sales_order_item",
  {
    id: text("id").primaryKey(),
    salesOrderId: text("sales_order_id")
      .notNull()
      .references(() => salesOrder.id, { onDelete: "cascade" }),

    rowNo: integer("row_no").notNull(),
    productId: text("product_id"),
    productCode: text("product_code"),
    description: text("description"),
    qty: text("qty").notNull().default("1"),
    uom: text("uom"),
    unitPrice: text("unit_price").default("0"),
    discountPct: text("discount_pct").default("0"),
    discountAmt: text("discount_amt").default("0"),
    totalPrice: text("total_price").default("0"),

    // Sell / rent
    lineType: text("line_type").notNull().default("sell"),
    rentalDuration: text("rental_duration"),
    rentalUnit: text("rental_unit"),

    // Resolved sourcing for this line: trading | oem. Inherited silently
    // from product.sourcingType when the product is fixed one way; chosen
    // explicitly when the product is "both" or has no catalog link. This is
    // what PR/PO creation reads — it never re-derives from product again.
    sourcingType: text("sourcing_type"),
    // OEM spec for this line — inherited from product.designBrandName/Code/
    // privateLabelCode, editable per order. Only meaningful when
    // sourcingType is "oem"; carries through to the supplier PO.
    designBrandName: text("design_brand_name"),
    designBrandCode: text("design_brand_code"),
    privateLabelCode: text("private_label_code"),
    // Provenance for designBrandName — "catalog" when auto-filled from a
    // design-code lookup, "user" once someone edits it directly. Mirrors
    // descriptionSource/codeSource below.
    designBrandSource: text("design_brand_source"),
    // Provenance for privateLabelCode (Emboss Code) — "auto" when filled
    // from the Code column on switching to OEM, "user" once edited directly.
    privateLabelSource: text("private_label_source"),

    // Set grouping
    setGroupId: text("set_group_id"),
    setGroupLabel: text("set_group_label"),
    setQty: text("set_qty"),

    sourceQuotationId: text("source_quotation_id"),
    sourceCustomerPoId: text("source_customer_po_id"),
    sourceCustomerPoNo: text("source_customer_po_no"),
    descriptionSource: json("description_source").$type<Array<"quote" | "catalog" | "user" | "cpo" | "so">>(),
    codeSource: json("code_source").$type<Array<"cpo" | "quotation" | "user" | "so">>(),
    qtySource: json("qty_source").$type<Array<"cpo" | "quotation" | "user" | "so">>(),
    uomSource: text("uom_source"),
    unitPriceSource: text("unit_price_source"),
    discountSource: text("discount_source"),
    editedBy: text("edited_by"),
    soEditedBy: text("so_edited_by"),
    isAdditional: boolean("is_additional").notNull().default(false),
    prExcluded: boolean("pr_excluded").notNull().default(false),
    approvalRejected: boolean("approval_rejected").notNull().default(false),
    approvalRejectedBy: text("approval_rejected_by"),
    approvalRejectedAt: timestamp("approval_rejected_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("sales_order_item_so_idx").on(t.salesOrderId)],
);

export const salesOrderCounter = pgTable("sales_order_counter", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const salesOrderRelations = relations(salesOrder, ({ one, many }) => ({
  organization: one(organization, {
    fields: [salesOrder.organizationId],
    references: [organization.id],
  }),
  quotation: one(quotation, {
    fields: [salesOrder.quotationId],
    references: [quotation.id],
  }),
  customerPo: one(customerPurchaseOrder, {
    fields: [salesOrder.customerPoId],
    references: [customerPurchaseOrder.id],
  }),
  customer: one(customer, {
    fields: [salesOrder.customerId],
    references: [customer.id],
  }),
  salesPerson: one(user, {
    fields: [salesOrder.salesPersonId],
    references: [user.id],
    relationName: "so_salesPerson",
  }),
  createdByUser: one(user, {
    fields: [salesOrder.createdBy],
    references: [user.id],
    relationName: "so_createdBy",
  }),
  submittedByUser: one(user, {
    fields: [salesOrder.submittedBy],
    references: [user.id],
    relationName: "so_submittedBy",
  }),
  approvedByUser: one(user, {
    fields: [salesOrder.approvedBy],
    references: [user.id],
    relationName: "so_approvedBy",
  }),
  items: many(salesOrderItem),
}));

export const salesOrderItemRelations = relations(salesOrderItem, ({ one }) => ({
  salesOrder: one(salesOrder, {
    fields: [salesOrderItem.salesOrderId],
    references: [salesOrder.id],
  }),
}));

/* ============================================================================================================================================================================================================================================
   CONSIGNMENT TABLES
=============================================================================================================================================================================================================================================== */

export const consignmentCounter = pgTable("consignment_counter", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
});

export const consignment = pgTable(
  "consignment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    consignmentNo: text("consignment_no").notNull(),
    soId: text("so_id").notNull().references(() => salesOrder.id),
    soNo: text("so_no").notNull(),
    customerId: text("customer_id").references(() => customer.id),
    customerSnapshot: json("customer_snapshot").$type<{
      title?: string; name: string; organizationName?: string;
      organizationAddress?: string; email?: string; contactNo?: string;
    }>(),
    sentDate: timestamp("sent_date"),
    expiryDate: timestamp("expiry_date"),
    notes: text("notes"),
    status: text("status").notNull().default("active"), // active | closed
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [index("consignment_org_idx").on(t.organizationId), index("consignment_so_idx").on(t.soId)],
);

export const consignmentItem = pgTable("consignment_item", {
  id: text("id").primaryKey(),
  consignmentId: text("consignment_id").notNull().references(() => consignment.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull(),
  productId: text("product_id").references(() => product.id),
  productCode: text("product_code"),
  description: text("description").notNull(),
  uom: text("uom"),
  unitPrice: text("unit_price").notNull().default("0"),
  qtySent: text("qty_sent").notNull().default("0"),
  qtyUsed: text("qty_used").notNull().default("0"),
  qtyReturned: text("qty_returned").notNull().default("0"),
});

export const consignmentUsage = pgTable("consignment_usage", {
  id: text("id").primaryKey(),
  consignmentId: text("consignment_id").notNull().references(() => consignment.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull(),
  usageDate: timestamp("usage_date").notNull(),
  type: text("type").notNull(), // "used" | "returned"
  notes: text("notes"),
  recordedBy: text("recorded_by").notNull().references(() => user.id),
  items: json("items").$type<{ consignmentItemId: string; qty: string }[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const consignmentRelations = relations(consignment, ({ one, many }) => ({
  organization: one(organization, { fields: [consignment.organizationId], references: [organization.id] }),
  salesOrder: one(salesOrder, { fields: [consignment.soId], references: [salesOrder.id] }),
  customer: one(customer, { fields: [consignment.customerId], references: [customer.id] }),
  createdByUser: one(user, { fields: [consignment.createdBy], references: [user.id] }),
  items: many(consignmentItem),
  usages: many(consignmentUsage),
}));

export const consignmentItemRelations = relations(consignmentItem, ({ one }) => ({
  consignment: one(consignment, { fields: [consignmentItem.consignmentId], references: [consignment.id] }),
  product: one(product, { fields: [consignmentItem.productId], references: [product.id] }),
}));

export const consignmentUsageRelations = relations(consignmentUsage, ({ one }) => ({
  consignment: one(consignment, { fields: [consignmentUsage.consignmentId], references: [consignment.id] }),
  recordedByUser: one(user, { fields: [consignmentUsage.recordedBy], references: [user.id] }),
}));

/* ============================================================================================================================================================================================================================================
   PURCHASE ORDER TABLE
=============================================================================================================================================================================================================================================== */

export const purchaseOrder = pgTable(
  "purchase_order",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    prNo: text("pr_no"),            // e.g. BMS-PR-2026-0001 — set at creation (null for legacy records)
    poNo: text("po_no"),            // e.g. BMS-PO-2026-0001 — set at approval (null in PR phase)

    // Link to source PR (new purchaseRequisition system — no FK to avoid circular dep)
    purchaseRequisitionId: text("purchase_requisition_id"),

    // Linked SO (optional — inherited from PR when converting, or set directly)
    salesOrderId: text("sales_order_id").references(() => salesOrder.id),

    // Supplier
    supplierId: text("supplier_id").references(() => supplier.id),
    supplierSnapshot: json("supplier_snapshot").$type<{
      name: string;
      registrationNo?: string;
      address?: string;
      contactPerson?: string;
      contactNo?: string;
      email?: string;
    }>(),

    // Supplier PDF quotation (stored in R2 private bucket supplier-quotation)
    supplierQuotationKey: text("supplier_quotation_key"),

    // Pricing
    subtotal: text("subtotal").notNull().default("0"),
    sst: text("sst").default("0"),
    sstPct: text("sst_pct").default("0"),
    grandTotal: text("grand_total").notNull().default("0"),

    notes: text("notes"),
    currency: text("currency").notNull().default("MYR"),
    status: text("status").notNull().default("draft"), // draft | submitted | confirmed | fulfilled | cancelled

    expectedDeliveryDate: timestamp("expected_delivery_date"),
    deliveryAddress: text("delivery_address"),

    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    approvedBy: text("approved_by").references(() => user.id),
    approvedAt: timestamp("approved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("purchase_order_no_org_uidx").on(t.organizationId, t.poNo),
    uniqueIndex("purchase_order_pr_no_org_uidx").on(t.organizationId, t.prNo),
    index("purchase_order_org_idx").on(t.organizationId),
  ],
);

export const purchaseOrderItem = pgTable(
  "purchase_order_item",
  {
    id: text("id").primaryKey(),
    purchaseOrderId: text("purchase_order_id")
      .notNull()
      .references(() => purchaseOrder.id, { onDelete: "cascade" }),

    rowNo: integer("row_no").notNull(),
    productId: text("product_id"),
    productCode: text("product_code"),
    description: text("description"),
    qty: text("qty").notNull().default("1"),
    uom: text("uom"),
    unitPrice: text("unit_price").default("0"),
    currency: text("currency").default("MYR"),
    totalPrice: text("total_price").default("0"),

    imageKey: text("image_key"), // optional R2 key for product image

    // Provenance for the description field itself — "product" when pulled
    // from the matched product's catalog description, "pr" when carried over
    // from the source purchase requisition line unedited. editedBy is set to
    // whoever last hand-typed the description directly; isAdditional flags a
    // line added on top of what a converted PR originally specified. Mirrors
    // the identical trio on purchaseRequisitionItem.
    descriptionSource: text("description_source"),
    isAdditional: boolean("is_additional").notNull().default(false),
    editedBy: text("edited_by"),

    setGroupId: text("set_group_id"),
    setGroupLabel: text("set_group_label"),
    setQty: text("set_qty"),

    // End-customer this line is ultimately destined for (e.g. a drop-ship
    // OEM order allocated per hospital/doctor) — optional, set by picking a
    // real customer record AND, since one customer can belong to several
    // customerOrganizations, which specific one applies to this line.
    // customerName/customerOrganization are a denormalized snapshot of both
    // taken at pick time, so display doesn't need a join and stays stable
    // even if the customer's org memberships change later.
    customerId: text("customer_id").references(() => customer.id),
    customerOrganizationId: text("customer_organization_id").references(() => customerOrganization.id),
    customerName: text("customer_name"),
    customerOrganization: text("customer_organization"),
    customerPoNo: text("customer_po_no"),

    // Sourcing: trading | oem — mirrors product.sourcingType /
    // salesOrderItem.sourcingType. Resolved once at line-creation time from
    // the matched product (silently inherited when the product is fixed one
    // way; left null for an explicit pick when the product is "both" or
    // unmatched) — never re-derived from the product afterwards.
    sourcingType: text("sourcing_type"),
    // OEM / private-label spec for this line — inherited from
    // product.designBrandName/Code/privateLabelCode, editable per order.
    // Only meaningful when sourcingType is "oem".
    designBrandName: text("design_brand_name"),
    designBrandCode: text("design_brand_code"),
    privateLabelCode: text("private_label_code"),
    // Provenance — "catalog" when auto-filled from the matched product,
    // "user" once edited directly. privateLabelSource also takes "auto" when
    // filled from the Code column on switching to OEM with no catalog match.
    designBrandSource: text("design_brand_source"),
    privateLabelSource: text("private_label_source"),
    // Who last hand-typed any of designBrandName/designBrandCode/
    // privateLabelCode on this line — one shared field since the three are
    // always edited together as a set, mirroring the dedicated editedBy
    // that description already has.
    oemEditedBy: text("oem_edited_by"),

    createdAt: timestamp("created_at").defaultNow().notNull(),

    // A short-shipped line normally self-resolves once a follow-up shipment
    // tops it up — the remaining-to-pack math already handles that
    // automatically. This is the manual override for the two ways it
    // DOESN'T self-resolve: "resolved" (the replacement showed up through
    // some means outside a formal packing list — a manual attestation, same
    // trust level as resolving a return/repair) or "written_off" (a
    // deliberate decision to stop chasing it — supplier dispute, accepting
    // the loss). Either one stops the item from appearing as remaining-to-
    // pack and drops it off the outstanding-issues monitoring list.
    shortfallClosedStatus: text("shortfall_closed_status"), // "resolved" | "written_off" | null
    shortfallClosedBy: text("shortfall_closed_by").references(() => user.id),
    shortfallClosedAt: timestamp("shortfall_closed_at"),
  },
  (t) => [index("purchase_order_item_po_idx").on(t.purchaseOrderId)],
);

export const purchaseOrderCounter = pgTable("purchase_order_counter", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const purchaseRequisitionCounter = pgTable("purchase_requisition_counter", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const purchaseRequisition = pgTable(
  "purchase_requisition",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    prNo: text("pr_no").notNull(),
    salesOrderId: text("sales_order_id").references(() => salesOrder.id),
    salesOrderNo: text("sales_order_no"),
    // Which CPO within the SO this PR covers (null = covers the whole SO)
    customerPoId: text("customer_po_id"),
    customerPoNo: text("customer_po_no"),
    status: text("status").notNull().default("draft"),
    // draft | submitted | approved | partially_ordered | ordered | cancelled
    prType: text("pr_type").notNull().default("customer_order"),
    // customer_order | replenishment | sample_demo
    samplePurpose: text("sample_purpose"),
    notes: text("notes"),
    deliveryDate: timestamp("delivery_date"),
    deliveryAddress: text("delivery_address"),
    deliveryAddressType: text("delivery_address_type"), // customer | warehouse | custom
    requestedBy: text("requested_by").notNull().references(() => user.id),
    approvedBy: text("approved_by").references(() => user.id),
    approvedAt: timestamp("approved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("purchase_requisition_no_org_uidx").on(t.organizationId, t.prNo),
    index("purchase_requisition_org_idx").on(t.organizationId),
  ],
);

export const purchaseRequisitionItem = pgTable(
  "purchase_requisition_item",
  {
    id: text("id").primaryKey(),
    purchaseRequisitionId: text("purchase_requisition_id").notNull().references(() => purchaseRequisition.id, { onDelete: "cascade" }),
    rowNo: integer("row_no").notNull(),
    productId: text("product_id"),
    productCode: text("product_code"),
    description: text("description"),
    qty: text("qty").notNull().default("1"),
    uom: text("uom"),
    estimatedUnitCost: text("estimated_unit_cost").default("0"),
    currency: text("currency").notNull().default("MYR"),
    totalEstimatedCost: text("total_estimated_cost").default("0"),
    preferredSupplierId: text("preferred_supplier_id"),
    preferredSupplierName: text("preferred_supplier_name"),
    purchaseOrderId: text("purchase_order_id"),
    purchaseOrderNo: text("purchase_order_no"),
    imageKey: text("image_key"),
    descriptionSource: text("description_source"),
    isAdditional: boolean("is_additional").notNull().default(false),
    editedBy: text("edited_by"),
    cpoNo: text("cpo_no"),
    customerName: text("customer_name"),
    customerOrganization: text("customer_organization"),
    setGroupId: text("set_group_id"),
    setGroupLabel: text("set_group_label"),
    setQty: text("set_qty"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("purchase_requisition_item_pr_idx").on(t.purchaseRequisitionId)],
);

export const goodsReceiptCounter = pgTable("goods_receipt_counter", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const goodsReceipt = pgTable(
  "goods_receipt",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    grNo: text("gr_no").notNull(),
    purchaseOrderId: text("purchase_order_id")
      .notNull()
      .references(() => purchaseOrder.id, { onDelete: "cascade" }),
    // Set when this GR was generated by completing inspection on a packing
    // list — a packing list spanning several POs produces one GR per PO,
    // all sharing this same packingListId.
    packingListId: text("packing_list_id").references(() => packingList.id),
    receivedDate: timestamp("received_date").notNull(),
    receivedBy: text("received_by")
      .notNull()
      .references(() => user.id),
    notes: text("notes"),
    // "confirmed" | "recalled" — recall reverses the stock-in movement (and
    // the PO's auto-fulfilled status, and reopens the source packing list
    // for correction) but keeps this row as an audit trail; only a recalled
    // GR can then be hard-deleted. Owner-only, see requireOwner below.
    status: text("status").notNull().default("confirmed"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("goods_receipt_no_org_uidx").on(t.organizationId, t.grNo),
    index("goods_receipt_po_idx").on(t.purchaseOrderId),
  ],
);

export const goodsReceiptItem = pgTable(
  "goods_receipt_item",
  {
    id: text("id").primaryKey(),
    goodsReceiptId: text("goods_receipt_id")
      .notNull()
      .references(() => goodsReceipt.id, { onDelete: "cascade" }),
    purchaseOrderItemId: text("purchase_order_item_id").references(() => purchaseOrderItem.id),
    productId: text("product_id"),
    productCode: text("product_code"),
    description: text("description"),
    qtyOrdered: text("qty_ordered").notNull().default("0"),
    qtyReceived: text("qty_received").notNull().default("0"),
    uom: text("uom"),
    unitPrice: text("unit_price").default("0"),
    currency: text("currency").default("MYR"),
    notes: text("notes"),

    // Inspection outcome — set only when this GR came from completing a
    // packing list; left null for the plain direct-PO receiving flow, which
    // has no inspection step. A received line splits into up to three
    // buckets: qtyGood (accepted, feeds stock), qtyReturn (goes back to the
    // supplier), qtyRepair (fixed in-house) — a single line can be mixed
    // across all three. Return and repair are tracked independently since a
    // line can need both at once.
    packingListItemId: text("packing_list_item_id").references(() => packingListItem.id),
    qtyGood: text("qty_good"),
    qtyReturn: text("qty_return"),
    qtyRepair: text("qty_repair"),
    returnStatus: text("return_status"), // "pending" | "resolved" — only set when qtyReturn > 0
    returnNotes: text("return_notes"),
    // Who marked the return resolved and when — set only on the
    // pending -> resolved transition, independent of the repair side below.
    returnResolvedBy: text("return_resolved_by").references(() => user.id),
    returnResolvedAt: timestamp("return_resolved_at"),
    repairStatus: text("repair_status"), // "pending" | "resolved" — only set when qtyRepair > 0
    repairNotes: text("repair_notes"),
    repairResolvedBy: text("repair_resolved_by").references(() => user.id),
    repairResolvedAt: timestamp("repair_resolved_at"),
    inspectedBy: text("inspected_by").references(() => user.id),
    inspectedAt: timestamp("inspected_at"),
  },
  (t) => [index("gr_item_gr_idx").on(t.goodsReceiptId)],
);

// ── Packing List ─────────────────────────────────────────────────────────────
// A pre-receipt manifest: what a supplier says they're shipping, created
// before goods physically arrive. Unlike a Goods Receipt (always exactly one
// PO), a single packing list can bundle items from several confirmed POs for
// the same supplier, or only a partial quantity of one PO's items — matching
// how a real supplier shipment doesn't always map 1:1 to a PO. Completing
// inspection on a packing list (see goodsReceiptItem above) produces one
// Goods Receipt per distinct PO among its items.

export const packingListCounter = pgTable("packing_list_counter", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const packingList = pgTable(
  "packing_list",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    packingListNo: text("packing_list_no").notNull(),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => supplier.id),
    supplierSnapshot: json("supplier_snapshot").$type<{
      name: string;
      registrationNo?: string;
      address?: string;
      contactPerson?: string;
      contactNo?: string;
      email?: string;
    }>(),
    supplierRefNo: text("supplier_ref_no"), // the packing list no. the supplier themselves printed, if any
    expectedDate: timestamp("expected_date"),
    status: text("status").notNull().default("pending"), // pending | completed | cancelled
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("packing_list_no_org_uidx").on(t.organizationId, t.packingListNo)],
);

export const packingListItem = pgTable(
  "packing_list_item",
  {
    id: text("id").primaryKey(),
    packingListId: text("packing_list_id")
      .notNull()
      .references(() => packingList.id, { onDelete: "cascade" }),
    // Display order — without this, row order isn't guaranteed to survive
    // repeated UPDATEs (autosaving inspection drafts touches every row) since
    // Postgres doesn't promise scan order absent an explicit ORDER BY.
    rowNo: integer("row_no").notNull().default(0),
    purchaseOrderId: text("purchase_order_id")
      .notNull()
      .references(() => purchaseOrder.id),
    purchaseOrderItemId: text("purchase_order_item_id")
      .notNull()
      .references(() => purchaseOrderItem.id),
    productId: text("product_id"),
    productCode: text("product_code"),
    description: text("description"),
    qtyExpected: text("qty_expected").notNull().default("0"),
    uom: text("uom"),
    unitPrice: text("unit_price").default("0"),
    currency: text("currency").default("MYR"),

    // Snapshot of the source PO item's OEM/identification detail — a packing
    // list is a logistics document, not a commercial one, so pricing above
    // is carried through for internal reference only and never displayed;
    // these fields are what actually helps someone identify the physical
    // item, matching what the PO itself shows.
    sourcingType: text("sourcing_type"),
    designBrandName: text("design_brand_name"),
    designBrandCode: text("design_brand_code"),
    privateLabelCode: text("private_label_code"),
    imageKey: text("image_key"),
    // Provenance — same meaning as on purchaseOrderItem, carried through so
    // the same badges ("from catalogue", "{username} edited SPO", etc.) can
    // render identically here.
    designBrandSource: text("design_brand_source"),
    privateLabelSource: text("private_label_source"),
    descriptionSource: text("description_source"),
    isAdditional: boolean("is_additional").notNull().default(false),
    editedBy: text("edited_by"),
    oemEditedBy: text("oem_edited_by"),

    // Set/group tag and end-customer allocation — also inherited verbatim.
    setGroupId: text("set_group_id"),
    setGroupLabel: text("set_group_label"),
    customerId: text("customer_id").references(() => customer.id),
    customerOrganizationId: text("customer_organization_id").references(() => customerOrganization.id),
    customerName: text("customer_name"),
    customerOrganization: text("customer_organization"),
    customerPoNo: text("customer_po_no"),

    // In-progress inspection state, autosaved line-by-line as soon as
    // someone edits it — this IS the draft; there's no separate draft
    // record. Lets several people inspect different lines of the same
    // packing list at once with zero conflict (each line saves
    // independently), and completePackingListInspection reads these back
    // when finalizing instead of taking a bulk submission. Null = untouched,
    // finalize falls back to qtyExpected / fully accepted.
    draftQtyReceived: text("draft_qty_received"),
    draftQtyReturn: text("draft_qty_return"),
    draftQtyRepair: text("draft_qty_repair"),
    draftReturnNotes: text("draft_return_notes"),
    draftRepairNotes: text("draft_repair_notes"),
    draftInspectedBy: text("draft_inspected_by").references(() => user.id),
    draftInspectedAt: timestamp("draft_inspected_at"),

    // Per-item approval stage — a second person (packing-list:approve) signs
    // off on the inspector's draft numbers before the packing list can be
    // completed into a Goods Receipt. Null until the line is first inspected;
    // any further edit to the draft above resets this back to "pending" since
    // the numbers being approved just changed. completePackingListInspection
    // refuses to run while any line isn't "approved".
    draftApprovalStatus: text("draft_approval_status"), // "pending" | "approved" | "rejected" | null
    draftApprovalNotes: text("draft_approval_notes"),
    draftApprovedBy: text("draft_approved_by").references(() => user.id),
    draftApprovedAt: timestamp("draft_approved_at"),
  },
  (t) => [index("packing_list_item_pl_idx").on(t.packingListId)],
);

export const packingListRelations = relations(packingList, ({ one, many }) => ({
  organization: one(organization, { fields: [packingList.organizationId], references: [organization.id] }),
  supplier: one(supplier, { fields: [packingList.supplierId], references: [supplier.id] }),
  createdByUser: one(user, { fields: [packingList.createdBy], references: [user.id] }),
  items: many(packingListItem),
  goodsReceipts: many(goodsReceipt),
}));

export const packingListItemRelations = relations(packingListItem, ({ one, many }) => ({
  packingList: one(packingList, { fields: [packingListItem.packingListId], references: [packingList.id] }),
  purchaseOrder: one(purchaseOrder, { fields: [packingListItem.purchaseOrderId], references: [purchaseOrder.id] }),
  purchaseOrderItem: one(purchaseOrderItem, { fields: [packingListItem.purchaseOrderItemId], references: [purchaseOrderItem.id] }),
  inspectionPhotos: many(inspectionPhoto),
}));

// Photos attached to a packing-list line during inspection — a real 1:many
// table rather than a JSON array column, so two people photographing the
// same line at the same time each just INSERT their own row (atomic,
// additive) instead of racing a read-modify-write on a shared array. Stays
// attached to the packingListItem permanently — goodsReceiptItem already
// links back to it via packingListItemId, so there's no need to duplicate
// these onto the GR side once inspection completes.
export const inspectionPhoto = pgTable(
  "inspection_photo",
  {
    id: text("id").primaryKey(),
    packingListItemId: text("packing_list_item_id")
      .notNull()
      .references(() => packingListItem.id, { onDelete: "cascade" }),
    imageKey: text("image_key").notNull(),
    // Which outcome this photo is evidence for — a line can be split across
    // both a return and a repair at once, so photos must say which is which
    // rather than sitting in one undifferentiated pile.
    category: text("category").notNull(), // "return" | "repair"
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("inspection_photo_item_idx").on(t.packingListItemId)],
);

export const inspectionPhotoRelations = relations(inspectionPhoto, ({ one }) => ({
  packingListItem: one(packingListItem, { fields: [inspectionPhoto.packingListItemId], references: [packingListItem.id] }),
  uploadedByUser: one(user, { fields: [inspectionPhoto.uploadedBy], references: [user.id] }),
}));

export const goodsReceiptRelations = relations(goodsReceipt, ({ one, many }) => ({
  organization: one(organization, { fields: [goodsReceipt.organizationId], references: [organization.id] }),
  purchaseOrder: one(purchaseOrder, { fields: [goodsReceipt.purchaseOrderId], references: [purchaseOrder.id] }),
  packingList: one(packingList, { fields: [goodsReceipt.packingListId], references: [packingList.id] }),
  receivedByUser: one(user, { fields: [goodsReceipt.receivedBy], references: [user.id] }),
  items: many(goodsReceiptItem),
}));

export const goodsReceiptItemRelations = relations(goodsReceiptItem, ({ one }) => ({
  goodsReceipt: one(goodsReceipt, { fields: [goodsReceiptItem.goodsReceiptId], references: [goodsReceipt.id] }),
  purchaseOrderItem: one(purchaseOrderItem, { fields: [goodsReceiptItem.purchaseOrderItemId], references: [purchaseOrderItem.id] }),
  packingListItem: one(packingListItem, { fields: [goodsReceiptItem.packingListItemId], references: [packingListItem.id] }),
  inspectedByUser: one(user, { fields: [goodsReceiptItem.inspectedBy], references: [user.id] }),
}));

export const purchaseOrderRelations = relations(purchaseOrder, ({ one, many }) => ({
  organization: one(organization, {
    fields: [purchaseOrder.organizationId],
    references: [organization.id],
  }),
  salesOrder: one(salesOrder, {
    fields: [purchaseOrder.salesOrderId],
    references: [salesOrder.id],
  }),
  supplier: one(supplier, {
    fields: [purchaseOrder.supplierId],
    references: [supplier.id],
  }),
  createdByUser: one(user, {
    fields: [purchaseOrder.createdBy],
    references: [user.id],
  }),
  items: many(purchaseOrderItem),
  customerPos: many(purchaseOrderCustomerPo),
  goodsReceipts: many(goodsReceipt),
}));

export const purchaseOrderItemRelations = relations(purchaseOrderItem, ({ one }) => ({
  purchaseOrder: one(purchaseOrder, {
    fields: [purchaseOrderItem.purchaseOrderId],
    references: [purchaseOrder.id],
  }),
}));

export const purchaseOrderCustomerPo = pgTable(
  "purchase_order_customer_po",
  {
    id: text("id").primaryKey(),
    purchaseOrderId: text("purchase_order_id")
      .notNull()
      .references(() => purchaseOrder.id, { onDelete: "cascade" }),
    customerPoId: text("customer_po_id")
      .notNull()
      .references(() => customerPurchaseOrder.id, { onDelete: "cascade" }),
    customerPoNo: text("customer_po_no").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("po_customer_po_po_idx").on(t.purchaseOrderId),
    index("po_customer_po_cpo_idx").on(t.customerPoId),
  ],
);

export const purchaseOrderCustomerPoRelations = relations(purchaseOrderCustomerPo, ({ one }) => ({
  purchaseOrder: one(purchaseOrder, { fields: [purchaseOrderCustomerPo.purchaseOrderId], references: [purchaseOrder.id] }),
  customerPo: one(customerPurchaseOrder, { fields: [purchaseOrderCustomerPo.customerPoId], references: [customerPurchaseOrder.id] }),
}));

/* ============================================================================================================================================================================================================================================
   CUSTOMER PURCHASE ORDER TABLE  (PO issued by customer to us)
=============================================================================================================================================================================================================================================== */

export const customerPurchaseOrder = pgTable(
  "customer_purchase_order",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    customerPoNo: text("customer_po_no").notNull(), // The PO number on customer's document

    customerId: text("customer_id").references(() => customer.id),
    customerSnapshot: json("customer_snapshot").$type<{
      title?: string;
      name: string;
      organizationName?: string;
      organizationAddress?: string;
      email?: string;
      contactNo?: string;
    }>(),

    // Links to our documents
    quotationId: text("quotation_id").references(() => quotation.id), // primary (first) quotation for backward compat
    quotationNo: text("quotation_no"),
    quotationLinks: json("quotation_links").$type<{ quotationId: string; quotationNo: string }[]>(),
    salesOrderId: text("sales_order_id").references(() => salesOrder.id),
    salesOrderNo: text("sales_order_no"),

    items: json("items").$type<{
      rowNo: number;
      productCode: string;
      description: string;
      qty: string;
      uom: string;
      unitPrice: string;
      discountPct: string;
      totalPrice: string;
      lineType: string;
      setGroupId?: string;
      setGroupLabel?: string;
      setQty?: string;
    }[]>(),

    amount: text("amount").notNull().default("0"),
    currency: text("currency").notNull().default("MYR"),

    // Scanned / PDF copy of customer's PO (R2 private)
    documentKey: text("document_key"),
    salesPersonName: text("sales_person_name"),
    associateSalesPersons: json("associate_sales_persons").$type<{ id: string; name: string }[]>(),
    notes: text("notes"),
    receivedDate: timestamp("received_date"),
    deliveryDate: timestamp("delivery_date"),
    deliveryAddress: text("delivery_address"),
    status: text("status").notNull().default("received"), // received | acknowledged | fulfilled | cancelled

    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("customer_po_org_idx").on(t.organizationId)],
);

export const customerPurchaseOrderRelations = relations(customerPurchaseOrder, ({ one }) => ({
  organization: one(organization, { fields: [customerPurchaseOrder.organizationId], references: [organization.id] }),
  customer: one(customer, { fields: [customerPurchaseOrder.customerId], references: [customer.id] }),
  quotation: one(quotation, { fields: [customerPurchaseOrder.quotationId], references: [quotation.id] }),
  salesOrder: one(salesOrder, { fields: [customerPurchaseOrder.salesOrderId], references: [salesOrder.id] }),
  createdByUser: one(user, { fields: [customerPurchaseOrder.createdBy], references: [user.id] }),
}));

/* ============================================================================================================================================================================================================================================
   DELIVERY ORDER TABLE
=============================================================================================================================================================================================================================================== */

export const deliveryOrder = pgTable(
  "delivery_order",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    doNo: text("do_no").notNull(), // e.g. BMS-DO-2025-0001

    salesOrderId: text("sales_order_id").references(() => salesOrder.id),
    salesOrderNo: text("sales_order_no"),

    // Which CPO within the SO this delivery fulfils
    customerPoId: text("customer_po_id").references((): AnyPgColumn => customerPurchaseOrder.id),
    customerPoNo: text("customer_po_no"),

    customerId: text("customer_id").references(() => customer.id),
    customerSnapshot: json("customer_snapshot").$type<{
      title?: string;
      name: string;
      organizationName?: string;
      organizationAddress?: string;
      email?: string;
      contactNo?: string;
    }>(),

    deliveredTo: text("delivered_to"),
    deliveryAddress: text("delivery_address"),
    deliveryDate: timestamp("delivery_date"),
    notes: text("notes"),
    status: text("status").notNull().default("draft"), // draft | delivered | returned

    // Case DO fields (medical/surgical case-based billing)
    isCaseDo: boolean("is_case_do").notNull().default(false),
    salesPersonId: text("sales_person_id").references(() => user.id),
    salesPersonName: text("sales_person_name"),
    applicationSpecialistId: text("application_specialist_id").references(() => user.id),
    applicationSpecialistName: text("application_specialist_name"),
    caseType: text("case_type"),
    caseDate: timestamp("case_date"),
    mrnNo: text("mrn_no"),

    categoryIds: json("category_ids").$type<string[]>().default([]).notNull(),

    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("delivery_order_no_org_uidx").on(t.organizationId, t.doNo),
    index("delivery_order_org_idx").on(t.organizationId),
  ],
);

export const deliveryOrderItem = pgTable(
  "delivery_order_item",
  {
    id: text("id").primaryKey(),
    deliveryOrderId: text("delivery_order_id")
      .notNull()
      .references(() => deliveryOrder.id, { onDelete: "cascade" }),
    soItemId: text("so_item_id").references(() => salesOrderItem.id, { onDelete: "set null" }),
    rowNo: integer("row_no").notNull(),
    productId: text("product_id").references(() => product.id),
    productCode: text("product_code"),
    description: text("description"),
    qty: text("qty").notNull().default("1"),
    uom: text("uom"),
    setGroupId: text("set_group_id"),
    setGroupLabel: text("set_group_label"),
    setQty: text("set_qty"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("delivery_order_item_do_idx").on(t.deliveryOrderId),
    index("delivery_order_item_product_idx").on(t.productId),
  ],
);

export const deliveryOrderCounter = pgTable("delivery_order_counter", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const deliveryOrderRelations = relations(deliveryOrder, ({ one, many }) => ({
  organization: one(organization, { fields: [deliveryOrder.organizationId], references: [organization.id] }),
  salesOrder: one(salesOrder, { fields: [deliveryOrder.salesOrderId], references: [salesOrder.id] }),
  customer: one(customer, { fields: [deliveryOrder.customerId], references: [customer.id] }),
  createdByUser: one(user, { fields: [deliveryOrder.createdBy], references: [user.id] }),
  items: many(deliveryOrderItem),
}));

export const deliveryOrderItemRelations = relations(deliveryOrderItem, ({ one }) => ({
  deliveryOrder: one(deliveryOrder, { fields: [deliveryOrderItem.deliveryOrderId], references: [deliveryOrder.id] }),
}));

/* ============================================================================================================================================================================================================================================
   INVOICE TABLE
=============================================================================================================================================================================================================================================== */

export const invoice = pgTable(
  "invoice",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    invoiceNo: text("invoice_no").notNull(), // e.g. BMS-INV-2025-0001
    invoiceDate: timestamp("invoice_date").defaultNow().notNull(),

    // Customer
    customerId: text("customer_id").references(() => customer.id),
    customerSnapshot: json("customer_snapshot").$type<{
      title?: string;
      name: string;
      organizationName?: string;
      organizationAddress?: string;
      email?: string;
      contactNo?: string;
    }>(),

    // Customer's PO (their authorization document)
    customerPoId: text("customer_po_id").references(() => customerPurchaseOrder.id),
    customerPoNo: text("customer_po_no"), // manual entry fallback

    // Our reference documents
    quotationId: text("quotation_id").references(() => quotation.id),
    quotationNo: text("quotation_no"),
    salesOrderId: text("sales_order_id").references(() => salesOrder.id),
    salesOrderNo: text("sales_order_no"),
    deliveryOrderId: text("delivery_order_id").references(() => deliveryOrder.id),
    deliveryOrderNo: text("delivery_order_no"),

    // Supplier / cost tracking
    purchaseOrderId: text("purchase_order_id").references(() => purchaseOrder.id),
    supplierId: text("supplier_id").references(() => supplier.id),
    supplierSnapshot: json("supplier_snapshot").$type<{
      name: string;
      registrationNo?: string;
      contactPerson?: string;
      contactNo?: string;
      email?: string;
    }>(),

    // Sales persons — primary + additional (cross-org support)
    salesPersonId: text("sales_person_id").references(() => user.id),
    salesPersonName: text("sales_person_name"),
    associateSalesPersons: json("associate_sales_persons")
      .$type<{ id?: string | null; name: string }[]>()
      .default([])
      .notNull(),

    // Application specialist (field support / case attendance)
    applicationSpecialistId: text("application_specialist_id").references(() => user.id),
    applicationSpecialistName: text("application_specialist_name"),

    // Billing address
    billingAddress: text("billing_address"),

    // Set groups
    sets: integer("sets").notNull().default(1),

    // Selling side — what we bill the customer
    subtotal: text("subtotal").notNull().default("0"),
    overallDiscountPct: text("overall_discount_pct").default("0"),
    overallDiscountAmt: text("overall_discount_amt").default("0"),
    sst: text("sst").default("0"),
    sstPct: text("sst_pct").default("0"),
    grandTotal: text("grand_total").notNull().default("0"), // invoice value

    // Cost side — what we paid the supplier
    costTotal: text("cost_total").default("0"),
    expensesTotal: text("expenses_total").default("0"),
    profit: text("profit").default("0"), // grandTotal − costTotal − expensesTotal

    // Surgical case details (from field tracking)
    caseDate: timestamp("case_date"),             // date the procedure was performed
    caseType: text("case_type"),                  // e.g. "EVLT", "MILH", "OTACL"
    caseTime: text("case_time"),                  // e.g. "8am-5pm", "Petang & Malam"
    mrnNo: text("mrn_no"),                        // hospital medical record number

    // Payment
    status: text("status").notNull().default("draft"), // draft | sent | paid | overdue | cancelled
    paymentTerms: text("payment_terms"), // "Net 30", "COD", etc.
    dueDate: timestamp("due_date"),
    paidAt: timestamp("paid_at"),
    paidAmount: text("paid_amount"),
    paymentRef: text("payment_ref"),              // cheque / bank transfer reference

    // Statement of Account
    soaVerified: boolean("soa_verified").default(false).notNull(),

    notes: text("notes"),

    categoryIds: json("category_ids").$type<string[]>().default([]).notNull(),

    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("invoice_no_org_uidx").on(t.organizationId, t.invoiceNo),
    index("invoice_org_idx").on(t.organizationId),
    index("invoice_customer_idx").on(t.customerId),
  ],
);

export const invoiceItem = pgTable(
  "invoice_item",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),

    rowNo: integer("row_no").notNull(),
    productId: text("product_id"),
    productCode: text("product_code"),
    description: text("description"),
    qty: text("qty").notNull().default("1"),
    uom: text("uom"),

    // Selling price (what we charge customer)
    unitPrice: text("unit_price").default("0"),
    discountPct: text("discount_pct").default("0"),
    discountAmt: text("discount_amt").default("0"),
    totalPrice: text("total_price").default("0"),

    // Cost price (from supplier / PO)
    costUnitPrice: text("cost_unit_price").default("0"),
    costTotal: text("cost_total").default("0"), // qty × costUnitPrice

    // Inherited from SO/quotation item (sell | rent)
    lineType: text("line_type").default("sell"),
    rentalDuration: text("rental_duration"),
    rentalUnit: text("rental_unit"),

    // Set grouping (inherited from SO/quotation)
    setGroupId: text("set_group_id"),
    setGroupLabel: text("set_group_label"),
    setQty: text("set_qty"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("invoice_item_invoice_idx").on(t.invoiceId)],
);

// Other expenses related to the invoice (transport, handling, customs, etc.)
export const invoiceExpense = pgTable(
  "invoice_expense",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),

    description: text("description").notNull(),
    category: text("category").default("other"), // transport | handling | customs | other
    amount: text("amount").notNull().default("0"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("invoice_expense_invoice_idx").on(t.invoiceId)],
);

export const invoiceCounter = pgTable("invoice_counter", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const invoiceStats = pgTable("invoice_stats", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  totalCount:       integer("total_count").notNull().default(0),
  draftCount:       integer("draft_count").notNull().default(0),
  sentCount:        integer("sent_count").notNull().default(0),
  paidCount:        integer("paid_count").notNull().default(0),
  overdueCount:     integer("overdue_count").notNull().default(0),
  cancelledCount:   integer("cancelled_count").notNull().default(0),
  totalBilled:      text("total_billed").notNull().default("0"),
  totalCollected:   text("total_collected").notNull().default("0"),
  totalOutstanding: text("total_outstanding").notNull().default("0"),
  soaPendingCount:  integer("soa_pending_count").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const invoiceRelations = relations(invoice, ({ one, many }) => ({
  organization: one(organization, { fields: [invoice.organizationId], references: [organization.id] }),
  customer: one(customer, { fields: [invoice.customerId], references: [customer.id] }),
  customerPo: one(customerPurchaseOrder, { fields: [invoice.customerPoId], references: [customerPurchaseOrder.id] }),
  salesOrder: one(salesOrder, { fields: [invoice.salesOrderId], references: [salesOrder.id] }),
  deliveryOrder: one(deliveryOrder, { fields: [invoice.deliveryOrderId], references: [deliveryOrder.id] }),
  purchaseOrder: one(purchaseOrder, { fields: [invoice.purchaseOrderId], references: [purchaseOrder.id] }),
  supplier: one(supplier, { fields: [invoice.supplierId], references: [supplier.id] }),
  salesPerson: one(user, { fields: [invoice.salesPersonId], references: [user.id] }),
  createdByUser: one(user, { fields: [invoice.createdBy], references: [user.id] }),
  items: many(invoiceItem),
  expenses: many(invoiceExpense),
  commission: one(caseCommission, { fields: [invoice.id], references: [caseCommission.invoiceId] }),
}));

export const invoiceItemRelations = relations(invoiceItem, ({ one }) => ({
  invoice: one(invoice, { fields: [invoiceItem.invoiceId], references: [invoice.id] }),
}));

export const invoiceExpenseRelations = relations(invoiceExpense, ({ one }) => ({
  invoice: one(invoice, { fields: [invoiceExpense.invoiceId], references: [invoice.id] }),
}));

// ── Case commission ────────────────────────────────────────────────────────────
// Tracks attendance fees and surgeon commissions linked to an invoice.
// Kept separate from the invoice so not every invoice needs a commission record.
export const caseCommission = pgTable(
  "case_commission",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .unique() // one commission record per invoice
      .references(() => invoice.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Attendance commission — paid to the staff member who attended the case
    claimedBy: text("claimed_by"),               // name of attendee e.g. "Taufik"
    claimedByUserId: text("claimed_by_user_id")  // FK if attendee is a system user
      .references(() => user.id),
    docs: text("docs"),                          // claim document ref e.g. "ACA-0324-Taufik"
    attendAmount: text("attend_amount").default("0"), // attendance fee amount

    // Surgeon commission — paid to the surgeon
    surgeonAmount: text("surgeon_amount").default("0"),
    surgeonPaidAt: timestamp("surgeon_paid_at"),

    // Additional incentive tracking
    incentive: text("incentive").default("0"),
    actualAmount: text("actual_amount").default("0"), // actual amount collected vs invoiced

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("case_commission_invoice_idx").on(t.invoiceId),
    index("case_commission_org_idx").on(t.organizationId),
  ],
);

export const caseCommissionRelations = relations(caseCommission, ({ one }) => ({
  invoice: one(invoice, {
    fields: [caseCommission.invoiceId],
    references: [invoice.id],
  }),
  organization: one(organization, {
    fields: [caseCommission.organizationId],
    references: [organization.id],
  }),
  claimedByUser: one(user, {
    fields: [caseCommission.claimedByUserId],
    references: [user.id],
  }),
}));

// ── Document numbering settings ───────────────────────────────────────────────
// One row per document type per org. Falls back to defaults if missing.
export const documentNumberingSetting = pgTable(
  "document_numbering_setting",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(), // qt | so | po | do | inv
    prefix: text("prefix").notNull().default(""),
    docCode: text("doc_code").notNull(), // e.g. "SO", "PO", "DO", "INV", "QT"
    separator: text("separator").notNull().default("-"),
    includeYear: integer("include_year").notNull().default(1), // 1 = yes, 0 = no
    paddingLength: integer("padding_length").notNull().default(4),
    numberFormat: text("number_format").notNull().default("standard"), // "standard" | "compact"
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("doc_numbering_org_doc_uq").on(t.organizationId, t.documentType),
  ],
);

/* =========================
   NOTIFICATION
========================= */

export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "so:submitted" | "so:approved" | "so:rejected" | "so:recalled"
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    isRead: integer("is_read").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("notification_user_idx").on(t.userId),
    index("notification_org_idx").on(t.organizationId),
    index("notification_unread_idx").on(t.userId, t.isRead),
  ],
);

export const notificationRelations = relations(notification, ({ one }) => ({
  user: one(user, { fields: [notification.userId], references: [user.id] }),
  organization: one(organization, { fields: [notification.organizationId], references: [organization.id] }),
}));

// LEDGER ─────────────────────────────────────────────────────────────────────

export const ledgerAccount = pgTable(
  "ledger_account",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    // ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE
    type: text("type").notNull(),
    // e.g. CASH | BANK | ACCOUNTS_RECEIVABLE | ACCOUNTS_PAYABLE | SHARE_CAPITAL | RETAINED_EARNINGS | SALARY_EXPENSE
    subtype: text("subtype"),
    // DEBIT | CREDIT  (Assets + Expenses = DEBIT normal; Liabilities + Equity + Revenue = CREDIT normal)
    normalBalance: text("normal_balance").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("ledger_account_org_code_uidx").on(t.organizationId, t.code),
    index("ledger_account_org_idx").on(t.organizationId),
  ],
);

export const ledgerEntry = pgTable(
  "ledger_entry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    entryNo: text("entry_no").notNull(),
    date: text("date").notNull(),          // ISO "YYYY-MM-DD"
    description: text("description").notNull(),
    // CAPITAL_INVESTMENT | SUPPLIER_PAYMENT | CUSTOMER_PAYMENT |
    // REVENUE_RECOGNITION | PURCHASE | PAYROLL | GENERAL_EXPENSE | JOURNAL_ADJUSTMENT
    transactionType: text("transaction_type").notNull(),
    // Polymorphic reference to source doc
    // INVOICE | PURCHASE_ORDER | PAYROLL_PERIOD | NONE
    referenceType: text("reference_type").notNull().default("NONE"),
    referenceId: text("reference_id"),
    referenceNo: text("reference_no"),     // snapshot e.g. "INV-2025-0001"
    // Stakeholder link: CUSTOMER | SUPPLIER | MEMBER | NONE
    stakeholderType: text("stakeholder_type").notNull().default("NONE"),
    stakeholderId: text("stakeholder_id"),
    stakeholderName: text("stakeholder_name"), // snapshot
    totalAmount: text("total_amount").notNull().default("0"),
    // DRAFT | POSTED | VOID
    status: text("status").notNull().default("DRAFT"),
    voidReason: text("void_reason"),
    postedAt: timestamp("posted_at"),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("ledger_entry_no_org_uidx").on(t.organizationId, t.entryNo),
    index("ledger_entry_org_idx").on(t.organizationId),
    index("ledger_entry_date_idx").on(t.date),
    index("ledger_entry_type_idx").on(t.transactionType),
  ],
);

export const ledgerLine = pgTable(
  "ledger_line",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => ledgerEntry.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccount.id),
    accountCode: text("account_code").notNull(),   // snapshot
    accountName: text("account_name").notNull(),   // snapshot
    debit: text("debit").notNull().default("0"),     // MYR (functional currency) — books of record
    credit: text("credit").notNull().default("0"),   // MYR (functional currency) — books of record
    currency: text("currency"),                      // foreign currency code, e.g. "USD" — null = MYR-only line
    amountForeign: text("amount_foreign"),            // original foreign-currency amount on this line
    exchangeRate: text("exchange_rate"),              // rate used to convert to MYR debit/credit above
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("ledger_line_entry_idx").on(t.entryId),
    index("ledger_line_account_idx").on(t.accountId),
  ],
);

export const ledgerDocument = pgTable(
  "ledger_document",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => ledgerEntry.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    // R2 key pattern: "{orgId}/{entryId}/{nanoid}.{ext}"
    fileKey: text("file_key").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),
    uploadedBy: text("uploaded_by").notNull().references(() => user.id),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (t) => [
    index("ledger_document_entry_idx").on(t.entryId),
    index("ledger_document_org_idx").on(t.organizationId),
  ],
);

// Relations
export const ledgerAccountRelations = relations(ledgerAccount, ({ one, many }) => ({
  organization: one(organization, { fields: [ledgerAccount.organizationId], references: [organization.id] }),
  lines: many(ledgerLine),
}));

export const ledgerEntryRelations = relations(ledgerEntry, ({ one, many }) => ({
  organization: one(organization, { fields: [ledgerEntry.organizationId], references: [organization.id] }),
  createdByUser: one(user, { fields: [ledgerEntry.createdBy], references: [user.id] }),
  lines: many(ledgerLine),
  documents: many(ledgerDocument),
}));

export const ledgerLineRelations = relations(ledgerLine, ({ one }) => ({
  entry: one(ledgerEntry, { fields: [ledgerLine.entryId], references: [ledgerEntry.id] }),
  account: one(ledgerAccount, { fields: [ledgerLine.accountId], references: [ledgerAccount.id] }),
}));

export const ledgerDocumentRelations = relations(ledgerDocument, ({ one }) => ({
  entry: one(ledgerEntry, { fields: [ledgerDocument.entryId], references: [ledgerEntry.id] }),
  organization: one(organization, { fields: [ledgerDocument.organizationId], references: [organization.id] }),
  uploadedByUser: one(user, { fields: [ledgerDocument.uploadedBy], references: [user.id] }),
}));

export const ledgerEntryInvoice = pgTable(
  "ledger_entry_invoice",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => ledgerEntry.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    invoiceNo: text("invoice_no").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("lei_entry_invoice_uidx").on(t.entryId, t.invoiceId),
    index("lei_entry_idx").on(t.entryId),
    index("lei_invoice_idx").on(t.invoiceId),
  ],
);

/* =========================
   LEAVE MANAGEMENT
========================= */

export const leaveType = pgTable(
  "leave_type",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    isPaid: boolean("is_paid").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    requiresDocument: boolean("requires_document").notNull().default(false),
    allowHalfDay: boolean("allow_half_day").notNull().default(true),
    maxDaysPerApplication: integer("max_days_per_application"),
    carryForwardEnabled: boolean("carry_forward_enabled").notNull().default(false),
    maxCarryForward: integer("max_carry_forward"),
    // How many months into the new year a carry-forward stays usable, e.g.
    // 3 = usable through 31 March, then forfeited — null = never expires
    // (today's behavior). Doesn't touch the stored carryForwardDays value
    // itself (kept as a historical record); only excludes it from the
    // available-balance calc past the cutoff. See isCarryForwardExpired in
    // server/leave.ts.
    carryForwardExpiryMonths: integer("carry_forward_expiry_months"),
    // When set, an application against THIS type that's <= this many days is
    // auto-labeled "Emergency Leave" (leaveApplication.leaveTypeName/Code)
    // instead of this type's own name/code — but still draws from this
    // type's own entitlement pool. Emergency Leave isn't a separate balance;
    // it's a short-application subset of whichever type this is set on
    // (normally Annual Leave). Null disables the behavior for this type.
    emergencyThresholdDays: integer("emergency_threshold_days"),
    // Org-wide policy toggles — checked against profile.employmentStatus /
    // member.leaveBlockedOnNotice in applyForLeave(). Defaults preserve
    // today's behavior (no restriction) for any existing/custom leave type;
    // seedDefaultLeaveTypes sets Annual Leave's actual values explicitly.
    allowDuringProbation: boolean("allow_during_probation").notNull().default(true),
    blockedDuringNotice: boolean("blocked_during_notice").notNull().default(false),
    // Types whose entitlement is earned via approved leaveCreditRequest rows
    // (e.g. Replacement Leave) instead of the entitlementRules tenure table
    // below — entitlementRules is conventionally left at a flat 0 for these,
    // and leaveEntitlement.earnedDays (credited on each approval) is what
    // actually funds the balance. See applyForReplacementCredit/
    // approveReplacementCredit in server/leave.ts.
    isCreditBased: boolean("is_credit_based").notNull().default(false),
    entitlementRules: json("entitlement_rules")
      .$type<Array<{ minYears: number; maxYears: number | null; days: number }>>()
      .notNull()
      .default([]),
    // Converts hours worked on a single date (a leaveCreditRequest work
    // line) into a day credit — e.g. <4h -> 0, 4-8h -> 0.5, 8h+ -> 1. Same
    // tiered shape as entitlementRules above, just keyed by hours instead
    // of years of service. Empty = fall back to a flat 1 day per date
    // (getCreditDaysForHours in server/leave.ts), so this is optional to
    // configure, not required for credit-based types to function.
    creditHourRules: json("credit_hour_rules")
      .$type<Array<{ minHours: number; maxHours: number | null; days: number }>>()
      .notNull()
      .default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("leave_type_org_code_uidx").on(t.organizationId, t.code),
    index("leave_type_org_idx").on(t.organizationId),
  ],
);

// HR-defined notice-period length (in days), keyed by employment status
// (probation | permanent) x department role (member | manager) — resigning
// managers commonly owe a longer notice than regular staff. Used to
// auto-calculate a resigning member's last working day from member.noticeDate.
// Absence of a row for a given org+status+role combo means "not yet set by
// HR" (no auto-calculation shown), not "zero days".
export const noticePeriodPolicy = pgTable(
  "notice_period_policy",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    employmentStatus: text("employment_status").notNull(), // "probation" | "permanent"
    departmentRole: text("department_role").notNull(), // "member" | "manager"
    noticePeriodDays: integer("notice_period_days").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("notice_period_policy_org_key_uidx").on(t.organizationId, t.employmentStatus, t.departmentRole),
  ],
);

export const leaveEntitlement = pgTable(
  "leave_entitlement",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    leaveTypeId: text("leave_type_id")
      .notNull()
      .references(() => leaveType.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    entitledDays: text("entitled_days").notNull().default("0"),
    usedDays: text("used_days").notNull().default("0"),
    pendingDays: text("pending_days").notNull().default("0"),
    carryForwardDays: text("carry_forward_days").notNull().default("0"),
    // Credited by approveReplacementCredit as replacement-leave-style
    // requests are approved (server/leave.ts) — additive like
    // carryForwardDays/openingBalance below, so ensureEntitlement's
    // entitledDays resync (which only recomputes from entitlementRules)
    // never touches or wipes it.
    earnedDays: text("earned_days").notNull().default("0"),
    // Manual starting balance carried in from before this system (e.g. migrating a running company)
    openingBalance: text("opening_balance").notNull().default("0"),
    openingBalanceSetBy: text("opening_balance_set_by").references(() => user.id),
    openingBalanceSetAt: timestamp("opening_balance_set_at"),
    // Days already taken before this system was adopted (tracked manually,
    // e.g. mid-year rollout) — subtracted from remaining, unlike
    // openingBalance above which is added. One-off backfill for the year
    // this was recorded in; does not carry forward to future years.
    openingUsedDays: text("opening_used_days").notNull().default("0"),
    openingUsedDaysSetBy: text("opening_used_days_set_by").references(() => user.id),
    openingUsedDaysSetAt: timestamp("opening_used_days_set_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("leave_entitlement_unique").on(t.organizationId, t.userId, t.leaveTypeId, t.year),
    index("leave_entitlement_user_idx").on(t.userId, t.organizationId),
  ],
);

export const leaveApplication = pgTable(
  "leave_application",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    applicationNo: text("application_no").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    leaveTypeId: text("leave_type_id")
      .notNull()
      .references(() => leaveType.id),
    leaveTypeName: text("leave_type_name").notNull(),
    leaveTypeCode: text("leave_type_code").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    totalDays: text("total_days").notNull(),
    isHalfDay: boolean("is_half_day").notNull().default(false),
    halfDayPeriod: text("half_day_period"),
    reason: text("reason"),
    status: text("status").notNull().default("PENDING"),
    reviewedBy: text("reviewed_by").references(() => user.id),
    reviewedAt: timestamp("reviewed_at"),
    reviewComment: text("review_comment"),
    cancelledBy: text("cancelled_by").references(() => user.id),
    cancelledAt: timestamp("cancelled_at"),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("leave_application_no_org_uidx").on(t.organizationId, t.applicationNo),
    index("leave_application_user_idx").on(t.userId, t.organizationId),
    index("leave_application_status_idx").on(t.status, t.organizationId),
    index("leave_application_date_idx").on(t.startDate),
  ],
);

// The "earn" side of a credit-based leave type (e.g. Replacement Leave) —
// distinct from leaveApplication (the "spend" side). Approving one of these
// credits leaveEntitlement.earnedDays; it never touches usedDays/pendingDays
// itself. See applyForReplacementCredit/approveReplacementCredit in
// server/leave.ts.
export const leaveCreditRequest = pgTable(
  "leave_credit_request",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    requestNo: text("request_no").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    leaveTypeId: text("leave_type_id")
      .notNull()
      .references(() => leaveType.id),
    leaveTypeName: text("leave_type_name").notNull(),
    leaveTypeCode: text("leave_type_code").notNull(),
    // Inclusive range of off-days/public holidays worked, in exchange for
    // the credit — every calendar date in this range (weekends included,
    // deliberately) gets its own itemized entry in workLines below.
    dateFrom: text("date_from").notNull(),
    dateUntil: text("date_until").notNull(),
    totalDays: text("total_days").notNull(),
    // One compulsory entry per date in [dateFrom, dateUntil] — the specific
    // hours worked and reason for that day, so an approver reviews each day
    // individually rather than trusting a single lump total. `days` is
    // computed server-side from timeFrom/timeUntil against the leave type's
    // creditHourRules at submission time and snapshotted here (same
    // rationale as leaveApplication snapshotting leaveTypeName/Code) so it
    // stays accurate even if the rules are edited later.
    workLines: json("work_lines")
      .$type<Array<{ date: string; timeFrom: string; timeUntil: string; reason: string; days: number }>>()
      .notNull()
      .default([]),
    status: text("status").notNull().default("PENDING"),
    reviewedBy: text("reviewed_by").references(() => user.id),
    reviewedAt: timestamp("reviewed_at"),
    reviewComment: text("review_comment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("leave_credit_request_no_org_uidx").on(t.organizationId, t.requestNo),
    index("leave_credit_request_user_idx").on(t.userId, t.organizationId),
    index("leave_credit_request_status_idx").on(t.status, t.organizationId),
  ],
);

export const leaveDocument = pgTable(
  "leave_document",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => leaveApplication.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileKey: text("file_key").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),
    uploadedBy: text("uploaded_by").notNull().references(() => user.id),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (t) => [
    index("leave_document_application_idx").on(t.applicationId),
    index("leave_document_org_idx").on(t.organizationId),
  ],
);

export const leaveTypeRelations = relations(leaveType, ({ one, many }) => ({
  organization: one(organization, { fields: [leaveType.organizationId], references: [organization.id] }),
  entitlements: many(leaveEntitlement),
  applications: many(leaveApplication),
}));

export const leaveEntitlementRelations = relations(leaveEntitlement, ({ one }) => ({
  organization: one(organization, { fields: [leaveEntitlement.organizationId], references: [organization.id] }),
  user: one(user, { fields: [leaveEntitlement.userId], references: [user.id] }),
  leaveType: one(leaveType, { fields: [leaveEntitlement.leaveTypeId], references: [leaveType.id] }),
}));

export const leaveApplicationRelations = relations(leaveApplication, ({ one, many }) => ({
  organization: one(organization, { fields: [leaveApplication.organizationId], references: [organization.id] }),
  user: one(user, { fields: [leaveApplication.userId], references: [user.id] }),
  leaveType: one(leaveType, { fields: [leaveApplication.leaveTypeId], references: [leaveType.id] }),
  reviewedByUser: one(user, { fields: [leaveApplication.reviewedBy], references: [user.id] }),
  cancelledByUser: one(user, { fields: [leaveApplication.cancelledBy], references: [user.id] }),
  documents: many(leaveDocument),
}));

export const leaveCreditRequestRelations = relations(leaveCreditRequest, ({ one }) => ({
  organization: one(organization, { fields: [leaveCreditRequest.organizationId], references: [organization.id] }),
  user: one(user, { fields: [leaveCreditRequest.userId], references: [user.id] }),
  leaveType: one(leaveType, { fields: [leaveCreditRequest.leaveTypeId], references: [leaveType.id] }),
  reviewedByUser: one(user, { fields: [leaveCreditRequest.reviewedBy], references: [user.id] }),
}));

export const leaveDocumentRelations = relations(leaveDocument, ({ one }) => ({
  application: one(leaveApplication, { fields: [leaveDocument.applicationId], references: [leaveApplication.id] }),
  organization: one(organization, { fields: [leaveDocument.organizationId], references: [organization.id] }),
  uploadedByUser: one(user, { fields: [leaveDocument.uploadedBy], references: [user.id] }),
}));


/* =========================
   CLAIM MANAGEMENT
========================= */

export const claimType = pgTable(
  "claim_type",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    // LOCAL | OVERSEAS | ENTERTAINMENT_FORM
    category: text("category").notNull().default("LOCAL"),
    // AMOUNT | KM — determines claim entry mode for travel section
    unitType: text("unit_type").notNull().default("AMOUNT"),
    // Rate per km for LOCAL travel. Null for non-km types.
    ratePerUnit: text("rate_per_unit"),
    requiresReceipt: boolean("requires_receipt").notNull().default(true),
    maxAmountPerClaim: text("max_amount_per_claim"),
    maxAmountPerYear: text("max_amount_per_year"),
    hotelCapPerNight: text("hotel_cap_per_night"),
    mealBreakfastRate: text("meal_breakfast_rate"),
    mealLunchRate: text("meal_lunch_rate"),
    mealDinnerRate: text("meal_dinner_rate"),
    isActive: boolean("is_active").notNull().default(true),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    // Ledger: expense account to debit when this claim type is approved
    debitAccountId: text("debit_account_id").references(() => ledgerAccount.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("claim_type_org_code_uidx").on(t.organizationId, t.code),
    index("claim_type_org_idx").on(t.organizationId),
  ],
);

export const claimApplication = pgTable(
  "claim_application",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    applicationNo: text("application_no").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    claimTypeId: text("claim_type_id")
      .notNull()
      .references(() => claimType.id),
    claimTypeName: text("claim_type_name").notNull(),
    claimTypeCode: text("claim_type_code").notNull(),
    claimDate: text("claim_date").notNull(),           // ISO YYYY-MM-DD (monthly: YYYY-MM-01)
    description: text("description").notNull(),
    unitType: text("unit_type").notNull().default("AMOUNT"),
    quantity: text("quantity"),
    ratePerUnit: text("rate_per_unit"),
    amount: text("amount").notNull().default("0"),     // total in MYR
    status: text("status").notNull().default("PENDING"), // DRAFT | PENDING | CHECKED | APPROVED | REJECTED | CANCELLED
    // Checker (first-level review)
    checkedBy: text("checked_by").references(() => user.id),
    checkedAt: timestamp("checked_at"),
    checkerComment: text("checker_comment"),
    // Approver (final review)
    reviewedBy: text("reviewed_by").references(() => user.id),
    reviewedAt: timestamp("reviewed_at"),
    reviewComment: text("review_comment"),
    cancelledBy: text("cancelled_by").references(() => user.id),
    cancelledAt: timestamp("cancelled_at"),
    cancelReason: text("cancel_reason"),
    // Auto-posted journal entry created on approval
    journalEntryId: text("journal_entry_id").references(() => ledgerEntry.id, { onDelete: "set null" }),
    // Bank transfer tracking — set once finance has actually paid an approved claim.
    // Independent of `status` (stays APPROVED); absence of paidAt means unpaid.
    paidAt: timestamp("paid_at"),
    paidBy: text("paid_by").references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("claim_application_no_org_uidx").on(t.organizationId, t.applicationNo),
    index("claim_application_user_idx").on(t.userId, t.organizationId),
    index("claim_application_status_idx").on(t.status, t.organizationId),
  ],
);

export const claimDocument = pgTable(
  "claim_document",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => claimApplication.id, { onDelete: "cascade" }),
    lineItemId: text("line_item_id")
      .references(() => claimLineItem.id, { onDelete: "set null" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileKey: text("file_key").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),
    uploadedBy: text("uploaded_by").notNull().references(() => user.id),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (t) => [
    index("claim_document_application_idx").on(t.applicationId),
    index("claim_document_org_idx").on(t.organizationId),
  ],
);

export const claimLineItem = pgTable(
  "claim_line_item",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => claimApplication.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull(),
    // LOCAL:   TRAVEL | TOLL | PARKING | MOBILE | IN_BASE_ENT | OTHER_LOCAL
    // OVERSEAS: OVERSEAS_MYR | OVERSEAS_FX | OVERSEAS_OTHER
    category: text("category").notNull(),
    lineDate: text("line_date").notNull(),
    description: text("description"),
    fromLocation: text("from_location"),
    toLocation: text("to_location"),
    distanceKm: text("distance_km"),
    ratePerUnit: text("rate_per_unit"),
    venue: text("venue"),
    destination: text("destination"),
    currency: text("currency"),
    amountForeign: text("amount_foreign"),
    exchangeRate: text("exchange_rate"),
    amountMyr: text("amount_myr").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Checker correction (edit) — frozen snapshot set only on first edit
    originalAmountMyr: text("original_amount_myr"),
    originalDescription: text("original_description"),
    editedBy: text("edited_by").references(() => user.id),
    editedAt: timestamp("edited_at"),
    editReason: text("edit_reason"),
    // Checker slash (reject this line) — toggle
    slashed: boolean("slashed").notNull().default(false),
    slashedBy: text("slashed_by").references(() => user.id),
    slashedAt: timestamp("slashed_at"),
    slashReason: text("slash_reason"),
    // Set only on TRAVEL-category rows created from an approved travel form
    travelFormId: text("travel_form_id").references(() => travelForm.id, { onDelete: "set null" }),
  },
  (t) => [
    index("claim_line_item_app_idx").on(t.applicationId),
    index("claim_line_item_org_idx").on(t.organizationId),
  ],
);

export const claimEntertainmentDetail = pgTable("claim_entertainment_detail", {
  id: text("id").primaryKey(),
  applicationId: text("application_id")
    .notNull()
    .references(() => claimApplication.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull(),
  eventDate: text("event_date").notNull(),
  restaurantName: text("restaurant_name").notNull(),
  customerName: text("customer_name").notNull(),
  departmentOrganization: text("department_organization").notNull(),
  purpose: text("purpose").notNull(),
  amount: text("amount").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Checker correction (edit) — frozen snapshot set only on first edit
  originalAmount: text("original_amount"),
  originalPurpose: text("original_purpose"),
  editedBy: text("edited_by").references(() => user.id),
  editedAt: timestamp("edited_at"),
  editReason: text("edit_reason"),
  // Checker slash (reject this line) — toggle
  slashed: boolean("slashed").notNull().default(false),
  slashedBy: text("slashed_by").references(() => user.id),
  slashedAt: timestamp("slashed_at"),
  slashReason: text("slash_reason"),
},
(t) => [
  index("claim_ent_detail_app_idx").on(t.applicationId),
]);

// Maps a line-item category (or "ENTERTAINMENT_FORM") → ledger expense account for the org.
// Used by approveClaim to post per-category debit lines instead of a single catch-all.
export const claimCategoryAccount = pgTable(
  "claim_category_account",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // LINE_CATEGORY value (TRAVEL | TOLL | PARKING | …) OR "ENTERTAINMENT_FORM"
    category: text("category").notNull(),
    ledgerAccountId: text("ledger_account_id")
      .notNull()
      .references(() => ledgerAccount.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("claim_category_account_org_cat_uidx").on(t.organizationId, t.category),
    index("claim_category_account_org_idx").on(t.organizationId),
  ],
);

export const claimCategoryAccountRelations = relations(claimCategoryAccount, ({ one }) => ({
  organization: one(organization, { fields: [claimCategoryAccount.organizationId], references: [organization.id] }),
  ledgerAccount: one(ledgerAccount, { fields: [claimCategoryAccount.ledgerAccountId], references: [ledgerAccount.id] }),
}));

export const claimTypeRelations = relations(claimType, ({ one, many }) => ({
  organization: one(organization, { fields: [claimType.organizationId], references: [organization.id] }),
  applications: many(claimApplication),
  debitAccount: one(ledgerAccount, { fields: [claimType.debitAccountId], references: [ledgerAccount.id] }),
}));

export const claimApplicationRelations = relations(claimApplication, ({ one, many }) => ({
  organization: one(organization, { fields: [claimApplication.organizationId], references: [organization.id] }),
  user: one(user, { fields: [claimApplication.userId], references: [user.id] }),
  claimType: one(claimType, { fields: [claimApplication.claimTypeId], references: [claimType.id] }),
  reviewedByUser: one(user, { fields: [claimApplication.reviewedBy], references: [user.id], relationName: "claim_reviewedBy" }),
  cancelledByUser: one(user, { fields: [claimApplication.cancelledBy], references: [user.id], relationName: "claim_cancelledBy" }),
  journalEntry: one(ledgerEntry, { fields: [claimApplication.journalEntryId], references: [ledgerEntry.id] }),
  documents: many(claimDocument),
  lineItems: many(claimLineItem),
  entertainmentDetails: many(claimEntertainmentDetail),
}));

export const claimDocumentRelations = relations(claimDocument, ({ one }) => ({
  application: one(claimApplication, { fields: [claimDocument.applicationId], references: [claimApplication.id] }),
  organization: one(organization, { fields: [claimDocument.organizationId], references: [organization.id] }),
  uploadedByUser: one(user, { fields: [claimDocument.uploadedBy], references: [user.id] }),
}));

export const claimLineItemRelations = relations(claimLineItem, ({ one }) => ({
  application: one(claimApplication, { fields: [claimLineItem.applicationId], references: [claimApplication.id] }),
  travelForm: one(travelForm, { fields: [claimLineItem.travelFormId], references: [travelForm.id] }),
}));

export const claimEntertainmentDetailRelations = relations(claimEntertainmentDetail, ({ one }) => ({
  application: one(claimApplication, { fields: [claimEntertainmentDetail.applicationId], references: [claimApplication.id] }),
}));


/* =========================
   TRAVEL FORM (pre-trip authorization)
========================= */

export const travelForm = pgTable(
  "travel_form",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    applicationNo: text("application_no").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Derived server-side from travel_form_stop rows at write time: earliest/
    // latest stop date and the sum of each stop's estimated cost. Purpose is
    // per-journey, stored on each travel_form_stop row instead of here.
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    estimatedCost: text("estimated_cost"),
    notes: text("notes"),
    status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | REJECTED | CANCELLED
    reviewedBy: text("reviewed_by").references(() => user.id),
    reviewedAt: timestamp("reviewed_at"),
    reviewComment: text("review_comment"),
    cancelledBy: text("cancelled_by").references(() => user.id),
    cancelledAt: timestamp("cancelled_at"),
    cancelReason: text("cancel_reason"),
    // Set once linked into a submitted claim line item — hides it from the picker
    claimedAt: timestamp("claimed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    uniqueIndex("travel_form_no_org_uidx").on(t.organizationId, t.applicationNo),
    index("travel_form_user_idx").on(t.userId, t.organizationId),
    index("travel_form_status_idx").on(t.status, t.organizationId),
  ],
);

export const travelFormDocument = pgTable(
  "travel_form_document",
  {
    id: text("id").primaryKey(),
    travelFormId: text("travel_form_id")
      .notNull()
      .references(() => travelForm.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileKey: text("file_key").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),
    uploadedBy: text("uploaded_by").notNull().references(() => user.id),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (t) => [
    index("travel_form_document_form_idx").on(t.travelFormId),
    index("travel_form_document_org_idx").on(t.organizationId),
  ],
);

export const travelFormStop = pgTable(
  "travel_form_stop",
  {
    id: text("id").primaryKey(),
    travelFormId: text("travel_form_id")
      .notNull()
      .references(() => travelForm.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    stopDate: text("stop_date").notNull(),
    fromLocation: text("from_location").notNull(),
    toLocation: text("to_location").notNull(),
    // Explicit "this leg starts a new journey" marker (set via "Add Separate
    // Journey"). Journey grouping normally infers breaks from route
    // continuity alone, but that's fooled when two genuinely separate trips
    // happen to share a location (e.g. both start from the same home base)
    // — this flag overrides that inference and is the source of truth once
    // persisted, rather than only living in client state during editing.
    journeyBreak: boolean("journey_break").notNull().default(false),
    mode: text("mode").notNull().default("OWN_VEHICLE"), // TRAVEL_MODE value, required, per-leg
    // Shared across every leg of the same journey (a "separate journey"
    // added on the form gets its own purpose; legs chained onto one journey
    // via Add Stop / Add Return Leg carry the same purpose forward).
    purpose: text("purpose").notNull(),
    distanceKm: text("distance_km"),
    estimatedCost: text("estimated_cost"), // per-leg, auto-filled then editable
  },
  (t) => [
    index("travel_form_stop_form_idx").on(t.travelFormId),
    index("travel_form_stop_org_idx").on(t.organizationId),
  ],
);

export const travelFormRelations = relations(travelForm, ({ one, many }) => ({
  organization: one(organization, { fields: [travelForm.organizationId], references: [organization.id] }),
  user: one(user, { fields: [travelForm.userId], references: [user.id] }),
  reviewedByUser: one(user, { fields: [travelForm.reviewedBy], references: [user.id], relationName: "travel_form_reviewedBy" }),
  cancelledByUser: one(user, { fields: [travelForm.cancelledBy], references: [user.id], relationName: "travel_form_cancelledBy" }),
  documents: many(travelFormDocument),
  stops: many(travelFormStop),
  claimLineItems: many(claimLineItem),
}));

export const travelFormDocumentRelations = relations(travelFormDocument, ({ one }) => ({
  travelForm: one(travelForm, { fields: [travelFormDocument.travelFormId], references: [travelForm.id] }),
  organization: one(organization, { fields: [travelFormDocument.organizationId], references: [organization.id] }),
  uploadedByUser: one(user, { fields: [travelFormDocument.uploadedBy], references: [user.id] }),
}));

export const travelFormStopRelations = relations(travelFormStop, ({ one }) => ({
  travelForm: one(travelForm, { fields: [travelFormStop.travelFormId], references: [travelForm.id] }),
  organization: one(organization, { fields: [travelFormStop.organizationId], references: [organization.id] }),
}));


/* =========================
   DOCUMENT CATEGORY
========================= */

export const documentCategory = pgTable(
  "document_category",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").default("#6366f1"),
    isDefault: boolean("is_default").default(false).notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("document_category_org_idx").on(t.organizationId),
  ],
);

export const documentCategoryRelations = relations(documentCategory, ({ one }) => ({
  organization: one(organization, { fields: [documentCategory.organizationId], references: [organization.id] }),
}));

/* =========================
   SALES ACTIVITY
========================= */

export const salesActivity = pgTable(
  "sales_activity",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    customerOrganization: text("customer_organization").notNull(),
    customerName: text("customer_name").notNull(),
    productCategory: text("product_category").notNull(),
    remark: text("remark"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("sales_activity_org_idx").on(t.organizationId),
    index("sales_activity_user_idx").on(t.userId),
    index("sales_activity_date_idx").on(t.date),
  ],
);

export const salesActivityRelations = relations(salesActivity, ({ one }) => ({
  organization: one(organization, { fields: [salesActivity.organizationId], references: [organization.id] }),
  user: one(user, { fields: [salesActivity.userId], references: [user.id] }),
}));

/* =========================
   WARRANT 2026
========================= */
export const warrant2026Config = pgTable("warrant_2026_config", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  columns: json("columns").notNull().default([]), // kept for potential future use
  sheetUrl: text("sheet_url"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const warrant2026ConfigRelations = relations(warrant2026Config, ({ one }) => ({
  organization: one(organization, { fields: [warrant2026Config.organizationId], references: [organization.id] }),
}));

export const warrant2026Row = pgTable(
  "warrant_2026_row",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull().default(0),
    cells: json("cells").notNull().default([]), // string[] — one value per column index
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedByName: text("updated_by_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("warrant_2026_org_idx").on(t.organizationId),
    index("warrant_2026_row_order_idx").on(t.organizationId, t.rowIndex),
  ],
);

export const warrant2026RowRelations = relations(warrant2026Row, ({ one }) => ({
  organization: one(organization, { fields: [warrant2026Row.organizationId], references: [organization.id] }),
  editor: one(user, { fields: [warrant2026Row.updatedBy], references: [user.id] }),
}));

/* =========================
   SCHEMA EXPORT
========================= */

export const schema = {
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
  organizationRole,
  team,
  teamMember,
  profile,
  product,
  userRelations,
  sessionRelations,
  accountRelations,
  organizationRelations,
  organizationRoleRelations,
  memberRelations,
  invitationRelations,
  // Custom Schema
  userPermission,
  userPermissionRelations,
  approvalSetting,
  orgDefaultPermission,
  sensitivePermission,
  permission,
  permissionRelations,
  teamRelations,
  teamMemberRelations,
  profileRelations,
  productRelations,
  // human resources
  payrollPeriod,
  payslip,
  payrollPeriodRelations,
  payslipRelations,
  organizationProfile,
  organizationProfileRelations,
  customer,
  customerRelations,
  customerOrganization,
  customerOrganizationRelations,
  customerCompany,
  customerCompanyRelations,
  quotation,
  quotationItem,
  quotationCounter,
  quotationRelations,
  quotationItemRelations,
  // supplier
  supplier,
  supplierRelations,
  // sales order
  salesOrder,
  salesOrderItem,
  salesOrderCounter,
  salesOrderRelations,
  salesOrderItemRelations,
  // purchase order
  purchaseOrder,
  purchaseOrderItem,
  purchaseOrderCounter,
  purchaseRequisitionCounter,
  purchaseRequisition,
  purchaseRequisitionItem,
  purchaseOrderCustomerPo,
  purchaseOrderRelations,
  purchaseOrderItemRelations,
  purchaseOrderCustomerPoRelations,
  // goods receipt
  goodsReceipt,
  goodsReceiptItem,
  goodsReceiptCounter,
  goodsReceiptRelations,
  goodsReceiptItemRelations,
  // packing list
  packingList,
  packingListItem,
  packingListCounter,
  packingListRelations,
  packingListItemRelations,
  // customer purchase order
  customerPurchaseOrder,
  customerPurchaseOrderRelations,
  // delivery order
  deliveryOrder,
  deliveryOrderItem,
  deliveryOrderCounter,
  deliveryOrderRelations,
  deliveryOrderItemRelations,
  // invoice
  invoice,
  invoiceItem,
  invoiceExpense,
  invoiceCounter,
  invoiceStats,
  invoiceRelations,
  invoiceItemRelations,
  invoiceExpenseRelations,
  // case commission
  caseCommission,
  caseCommissionRelations,
  // document numbering
  documentNumberingSetting,
  // department
  department,
  // member department assignments (junction)
  memberDepartment,
  // owner-approval queue for invites / department assignments made by non-owners
  pendingInvitation,
  pendingDepartmentAssignment,
  // notifications
  notification,
  notificationRelations,
  // ledger
  ledgerAccount,
  ledgerEntry,
  ledgerLine,
  ledgerDocument,
  ledgerEntryInvoice,
  ledgerAccountRelations,
  ledgerEntryRelations,
  ledgerLineRelations,
  ledgerDocumentRelations,
  // leave management
  leaveType,
  leaveEntitlement,
  leaveApplication,
  leaveCreditRequest,
  leaveDocument,
  leaveTypeRelations,
  leaveEntitlementRelations,
  leaveApplicationRelations,
  leaveCreditRequestRelations,
  leaveDocumentRelations,
  // claim management
  claimType,
  claimApplication,
  claimDocument,
  claimLineItem,
  claimEntertainmentDetail,
  claimCategoryAccount,
  claimTypeRelations,
  claimApplicationRelations,
  claimDocumentRelations,
  claimLineItemRelations,
  claimEntertainmentDetailRelations,
  claimCategoryAccountRelations,
  // travel form
  travelForm,
  travelFormDocument,
  travelFormStop,
  travelFormRelations,
  travelFormDocumentRelations,
  travelFormStopRelations,
  // inventory
  stockLevel,
  stockMovement,
  stockLevelRelations,
  stockMovementRelations,
  stockRequest,
  staffStockLimit,
  stockRequestRelations,
  staffStockLimitRelations,
  // consignment
  consignmentCounter,
  consignment,
  consignmentItem,
  consignmentUsage,
  consignmentRelations,
  consignmentItemRelations,
  consignmentUsageRelations,
  // document categories
  documentCategory,
  documentCategoryRelations,
  // sales activity
  salesActivity,
  salesActivityRelations,
  // warrant 2026
  warrant2026Config,
  warrant2026ConfigRelations,
  warrant2026Row,
  warrant2026RowRelations,
};
