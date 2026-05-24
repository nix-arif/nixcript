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
  (table) => [uniqueIndex("organization_slug_uidx").on(table.slug)],
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
    createdAt: timestamp("created_at").notNull(),
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
    unitPrice: text("unit_price"),
    uom: text("uom"),
    supplier: text("supplier"),
    brand: text("brand"),

    // Image
    imageKey: text("image_key"), // R2 key for product catalogue image

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

  // Table style
  tableRowStyle: text("table_row_style").default("default"), // default | simple | rounded
  showCodeColumn: integer("show_code_column").default(1),

  // Quotation number format: A | B | C
  quotationNoFormat: text("quotation_no_format").default("A"),

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

export const customerCompany = pgTable(
  "customer_company",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    organizationName: text("organization_name"),
    organizationAddress: text("organization_address"),
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
}));

/* ============================================================================================================================================================================================================================================
   QUOTATION TABLE
=============================================================================================================================================================================================================================================== */

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
    preparedById: text("prepared_by_id").references(() => user.id),
    preparedByName: text("prepared_by_name"),
    validUntil: timestamp("valid_until"),
    notes: text("notes"),

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

    // Status
    status: text("status").notNull().default("draft"), // draft | final

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
    rowNo: integer("row_no").notNull(),
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

    // Source flags — which columns came from spreadsheet vs DB
    descriptionSource: text("description_source").default("db"), // db | sheet
    priceSource: text("price_source").default("db"), // db | sheet
    uomSource: text("uom_source").default("db"), // db | sheet

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
    linkedQuotations: json("linked_quotations").$type<{ id: string; quotationNo: string }[]>(),

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

    // Pricing
    subtotal: text("subtotal").notNull().default("0"),
    overallDiscountPct: text("overall_discount_pct").default("0"),
    overallDiscountAmt: text("overall_discount_amt").default("0"),
    sst: text("sst").default("0"),
    sstPct: text("sst_pct").default("0"),
    grandTotal: text("grand_total").notNull().default("0"),

    notes: text("notes"),
    status: text("status").notNull().default("draft"), // draft | confirmed | fulfilled | cancelled

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
   PURCHASE ORDER TABLE
=============================================================================================================================================================================================================================================== */

export const purchaseOrder = pgTable(
  "purchase_order",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    poNo: text("po_no").notNull(), // e.g. BMS-PO-2025-0001

    // Linked SO (optional)
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
    status: text("status").notNull().default("draft"), // draft | sent | acknowledged | received | cancelled

    expectedDeliveryDate: timestamp("expected_delivery_date"),
    deliveryAddress: text("delivery_address"),

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
    uniqueIndex("purchase_order_no_org_uidx").on(t.organizationId, t.poNo),
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
    totalPrice: text("total_price").default("0"),

    imageKey: text("image_key"), // optional R2 key for product image

    createdAt: timestamp("created_at").defaultNow().notNull(),
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
}));

export const purchaseOrderItemRelations = relations(purchaseOrderItem, ({ one }) => ({
  purchaseOrder: one(purchaseOrder, {
    fields: [purchaseOrderItem.purchaseOrderId],
    references: [purchaseOrder.id],
  }),
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
    quotationId: text("quotation_id").references(() => quotation.id),
    quotationNo: text("quotation_no"),
    salesOrderId: text("sales_order_id").references(() => salesOrder.id),
    salesOrderNo: text("sales_order_no"),

    amount: text("amount").notNull().default("0"),
    currency: text("currency").notNull().default("MYR"),

    // Scanned / PDF copy of customer's PO (R2 private)
    documentKey: text("document_key"),
    notes: text("notes"),
    receivedDate: timestamp("received_date"),
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
    rowNo: integer("row_no").notNull(),
    productCode: text("product_code"),
    description: text("description"),
    qty: text("qty").notNull().default("1"),
    uom: text("uom"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("delivery_order_item_do_idx").on(t.deliveryOrderId)],
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

    // Sales person
    salesPersonId: text("sales_person_id").references(() => user.id),
    salesPersonName: text("sales_person_name"),

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

    // Payment
    status: text("status").notNull().default("draft"), // draft | sent | paid | overdue | cancelled
    paymentTerms: text("payment_terms"), // "Net 30", "COD", etc.
    dueDate: timestamp("due_date"),
    paidAt: timestamp("paid_at"),
    paidAmount: text("paid_amount"),

    notes: text("notes"),

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
}));

export const invoiceItemRelations = relations(invoiceItem, ({ one }) => ({
  invoice: one(invoice, { fields: [invoiceItem.invoiceId], references: [invoice.id] }),
}));

export const invoiceExpenseRelations = relations(invoiceExpense, ({ one }) => ({
  invoice: one(invoice, { fields: [invoiceExpense.invoiceId], references: [invoice.id] }),
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
  purchaseOrderRelations,
  purchaseOrderItemRelations,
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
  invoiceRelations,
  invoiceItemRelations,
  invoiceExpenseRelations,
  // document numbering
  documentNumberingSetting,
  // department
  department,
  // member department assignments (junction)
  memberDepartment,
  // notifications
  notification,
  notificationRelations,
};
