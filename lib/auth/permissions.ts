// @/lib/auth/permissions.ts
import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  adminAc,
} from "better-auth/plugins/organization/access";

const statement = {
  // ac: ["read", "create", "update", "delete"], // 🔥 REQUIRED
  ...defaultStatements,
  project: ["read", "create", "share", "update", "delete"],
} as const;

const ac = createAccessControl(statement);

const member = ac.newRole({
  project: ["create"],
});
const adminOrg = ac.newRole({
  project: ["create", "update"],
});
const owner = ac.newRole({
  // ac: ["read", "create", "update", "delete"],
  ...adminAc.statements,
  project: ["read", "create", "update", "delete"],
});

export { ac, member, adminOrg, owner };
