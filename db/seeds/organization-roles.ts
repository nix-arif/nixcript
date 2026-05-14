// // lib/seeds/organization-roles.ts
// import { db } from "@/db";
// import { organizationRole } from "@/db/schema";
// import { nanoid } from "nanoid";

// const defaultOrgRoles = [
//   {
//     role: "admin",
//     permissions: [
//       "quotation:read",
//       "quotation:create",
//       "quotation:update",
//       "quotation:delete",
//       "sales-order:read",
//       "sales-order:create",
//       "sales-order:update",
//       "sales-order:delete",
//       "delivery-order:read",
//       "delivery-order:create",
//       "delivery-order:update",
//       "delivery-order:delete",
//       "invoice:read",
//       "invoice:create",
//       "invoice:update",
//       "invoice:delete",
//       "organization-role:create",
//       "organization-role:update",
//       "organization-role:delete",
//       "member:invite",
//       "member:read",
//       "member:remove",
//       "permission:read",
//       "permission:create",
//       "permission:delete",
//     ],
//   },
//   {
//     role: "member",
//     permissions: [
//       "quotation:read",
//       "sales-order:read",
//       "delivery-order:read",
//       "invoice:read",
//       "member:read",
//     ],
//   },
// ];

// export async function seedOrganizationRoles(organizationId: string) {
//   for (const r of defaultOrgRoles) {
//     await db
//       .insert(organizationRole)
//       .values({
//         id: nanoid(),
//         organizationId,
//         role: r.role,
//         permission: JSON.stringify(r.permissions),
//       })
//       .onConflictDoNothing();
//   }
// }
