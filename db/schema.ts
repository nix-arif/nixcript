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
    role: text("role").default("member").notNull(),
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
    role: text("role"),
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
   ROLE PERMISSION
========================= */

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
};
