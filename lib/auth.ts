// @/lib/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization, customSession } from "better-auth/plugins";
import { db } from "@/db";
import { profile, schema, session } from "@/db/schema";
import { nextCookies } from "better-auth/next-js";
import { getActiveOrganization } from "@/server/organizations";
import OrganizationInvitationEmail from "@/components/emails/organization-invitation";
import ResetPasswordEmail from "@/components/emails/reset-password";
import { Resend } from "resend";
import { onOrganizationCreated } from "./organization/on-created";
import { nanoid } from "nanoid";
// import { seedOrganizationRoles } from "@/db/seeds/organization-roles";

const resend = new Resend(process.env.RESEND_API_KEY as string);

const isProduction = process.env.NODE_ENV === "production";
const baseUrl = isProduction
  ? process.env.APP_DOMAIN
  : process.env.BETTER_AUTH_URL;

export const auth = betterAuth({
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const organization = await getActiveOrganization(session.userId);
          return {
            data: {
              ...session,
              activeOrganizationId: organization?.id,
            },
          };
        },
      },
    },
    user: {
      create: {
        after: async (user) => {
          await db
            .insert(profile)
            .values({
              id: nanoid(),
              userId: user.id,
              personalEmail: user.email ?? "",
              pdpaConsent: false,
            })
            .onConflictDoNothing();
        },
      },
    },
  },
  trustedOrigins: [
    "https://nixcrip.com",
    "https://www.nixcrip.com",
    "http://localhost:3000",
    "http://192.168.0.117:3000",
  ],

  database: drizzleAdapter(db, { provider: "pg", schema }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 3,
    async sendResetPassword({ user, url }) {
      await resend.emails.send({
        from: `${process.env.EMAIL_SENDER_NAME} <${process.env.EMAIL_SENDER_ADDRESS}>`,
        to: user.email,
        subject: "Reset your password",
        react: ResetPasswordEmail({ email: user.email, resetLink: url }),
      });
    },
  },

  plugins: [
    admin(),
    organization({
      allowUserToCreateOrganization: async (user) => {
        if (user.role === "admin") return true;
        else return false;
      },
      organizationHooks: {
        afterCreateOrganization: async ({ organization, member, user }) => {
          // Run custom logic after organization is created
          // e.g., create default resources, send notifications
          // await seedOrganizationRoles(organization.id);
          await onOrganizationCreated(organization.id, member.userId);
        },
      },

      dynamicAccessControl: {
        enabled: true,
      },
      teams: { enabled: true },

      async sendInvitationEmail(data) {
        const inviteLink = `${baseUrl}/api/accept-invitation/${data.id}`;

        const { data: dataResend, error } = await resend.emails.send({
          from: `${process.env.EMAIL_SENDER_NAME} <${process.env.EMAIL_SENDER_ADDRESS}>`,
          to: data.email,
          subject: "You've been invited to join our organization",
          react: OrganizationInvitationEmail({
            email: data.email,
            invitedByUsername: data.inviter.user.name,
            invitedByEmail: data.inviter.user.email,
            teamName: data.organization.name,
            inviteLink,
          }),
        });
      },
    }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
