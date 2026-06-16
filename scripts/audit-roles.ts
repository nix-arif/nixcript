// Static audit: checks the *role* side of RBAC, which audit-permissions.ts doesn't cover.
//
// audit-permissions.ts answers: "does this button's client-side gate match what the
// server enforces?" This script answers three different questions:
//
//   1. Does every permission string used in STAKEHOLDER_PERMISSIONS, DEPT_ROLE_PERMISSIONS,
//      PERMISSION_BUNDLES, and lib/nav.ts actually exist in ALL_PERMISSIONS / APPROVAL_ONLY_KEYS?
//      (catches typos / stale keys left behind after a rename)
//   2. Does the permission a nav item is gated on match the requirePermission() call
//      actually guarding that page? (catches the case found this session: nav.ts gated
//      "Purchase Requisition" on purchase-order:read while the page itself now requires
//      purchase-requisition:read)
//   3. For every built-in role (owner, stakeholder, each department's manager/member),
//      which nav items can they reach — and which permissions/nav items are granted by
//      NO built-in role at all (only reachable via owner's "*" or a manual per-user grant)?
//
// Run: npx tsx scripts/audit-roles.ts [--verbose]

import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const verbose = process.argv.includes("--verbose");

function parse(file: string): ts.SourceFile {
  const text = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function unwrap(expr: ts.Expression): ts.Expression {
  while (ts.isAsExpression(expr) || ts.isParenthesizedExpression(expr)) {
    expr = expr.expression;
  }
  return expr;
}

function findExportedConst(sf: ts.SourceFile, name: string): ts.Expression | null {
  let found: ts.Expression | null = null;
  function visit(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
      found = unwrap(n.initializer);
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
  return found;
}

function stringLiteralsOf(expr: ts.Node): string[] {
  const out: string[] = [];
  if (ts.isArrayLiteralExpression(expr)) {
    for (const el of expr.elements) {
      if (ts.isStringLiteral(el)) out.push(el.text);
    }
  }
  return out;
}

function objectProp(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) {
      return p.initializer;
    }
  }
  return null;
}

// ── 1. Load constants.ts ────────────────────────────────────────────────────

const constantsPath = path.join(ROOT, "lib/permissions/constants.ts");
const constantsSf = parse(constantsPath);

const allPermissionsExpr = findExportedConst(constantsSf, "ALL_PERMISSIONS");
const allPermissionKeys = new Set<string>();
if (allPermissionsExpr && ts.isArrayLiteralExpression(allPermissionsExpr)) {
  for (const el of allPermissionsExpr.elements) {
    if (ts.isObjectLiteralExpression(el)) {
      const keyExpr = objectProp(el, "key");
      if (keyExpr && ts.isStringLiteral(keyExpr)) allPermissionKeys.add(keyExpr.text);
    }
  }
}

const approvalOnlyExpr = findExportedConst(constantsSf, "APPROVAL_ONLY_KEYS");
const approvalOnlyKeys = new Set(approvalOnlyExpr ? stringLiteralsOf(approvalOnlyExpr) : []);

const canonicalKeys = new Set([...allPermissionKeys, ...approvalOnlyKeys]);

const stakeholderExpr = findExportedConst(constantsSf, "STAKEHOLDER_PERMISSIONS");
const stakeholderPerms = stakeholderExpr ? stringLiteralsOf(stakeholderExpr) : [];

const deptRoleExpr = findExportedConst(constantsSf, "DEPT_ROLE_PERMISSIONS");
const deptRolePerms = new Map<string, { manager: string[]; member: string[] }>();
if (deptRoleExpr && ts.isObjectLiteralExpression(deptRoleExpr)) {
  for (const p of deptRoleExpr.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const deptName = ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : null;
    if (!deptName || !ts.isObjectLiteralExpression(p.initializer)) continue;
    const managerExpr = objectProp(p.initializer, "manager");
    const memberExpr = objectProp(p.initializer, "member");
    deptRolePerms.set(deptName, {
      manager: managerExpr ? stringLiteralsOf(managerExpr) : [],
      member: memberExpr ? stringLiteralsOf(memberExpr) : [],
    });
  }
}

const bundlesExpr = findExportedConst(constantsSf, "PERMISSION_BUNDLES");
const bundles: { id: string; permissions: string[] }[] = [];
if (bundlesExpr && ts.isArrayLiteralExpression(bundlesExpr)) {
  for (const el of bundlesExpr.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue;
    const idExpr = objectProp(el, "id");
    const permsExpr = objectProp(el, "permissions");
    if (idExpr && ts.isStringLiteral(idExpr) && permsExpr) {
      bundles.push({ id: idExpr.text, permissions: stringLiteralsOf(permsExpr) });
    }
  }
}

// ── 2. Load nav.ts ───────────────────────────────────────────────────────────

const navPath = path.join(ROOT, "lib/nav.ts");
const navSf = parse(navPath);
const navConfigExpr = findExportedConst(navSf, "navConfig");

type NavItem = { group: string; title: string; url: string; permission: string | null };
const navItems: NavItem[] = [];
if (navConfigExpr && ts.isArrayLiteralExpression(navConfigExpr)) {
  for (const groupEl of navConfigExpr.elements) {
    if (!ts.isObjectLiteralExpression(groupEl)) continue;
    const groupTitleExpr = objectProp(groupEl, "title");
    const groupTitle = groupTitleExpr && ts.isStringLiteral(groupTitleExpr) ? groupTitleExpr.text : "?";
    const itemsExpr = objectProp(groupEl, "items");
    if (!itemsExpr || !ts.isArrayLiteralExpression(itemsExpr)) continue;
    for (const itemEl of itemsExpr.elements) {
      if (!ts.isObjectLiteralExpression(itemEl)) continue;
      const titleExpr = objectProp(itemEl, "title");
      const urlExpr = objectProp(itemEl, "url");
      const permExpr = objectProp(itemEl, "permission");
      navItems.push({
        group: groupTitle,
        title: titleExpr && ts.isStringLiteral(titleExpr) ? titleExpr.text : "?",
        url: urlExpr && ts.isStringLiteral(urlExpr) ? urlExpr.text : "",
        permission: permExpr && ts.isStringLiteral(permExpr) ? permExpr.text : null,
      });
    }
  }
}

// ── Check 1: unknown permission keys ────────────────────────────────────────

const unknownKeyFindings: string[] = [];
function checkKeys(source: string, keys: string[]) {
  for (const k of keys) {
    if (!canonicalKeys.has(k)) unknownKeyFindings.push(`${source}: "${k}"`);
  }
}
checkKeys("STAKEHOLDER_PERMISSIONS", stakeholderPerms);
for (const [dept, roles] of deptRolePerms) {
  checkKeys(`DEPT_ROLE_PERMISSIONS.${dept}.manager`, roles.manager);
  checkKeys(`DEPT_ROLE_PERMISSIONS.${dept}.member`, roles.member);
}
for (const b of bundles) checkKeys(`PERMISSION_BUNDLES["${b.id}"]`, b.permissions);
checkKeys("lib/nav.ts", navItems.filter((i) => i.permission).map((i) => i.permission!));

// ── Check 2: nav permission vs. page's actual requirePermission() ──────────

type PageCheck = { item: NavItem; status: "OK" | "MISMATCH" | "NO_CHECK" | "NOT_FOUND"; actual: string | null };
const pageChecks: PageCheck[] = [];

for (const item of navItems) {
  if (!item.permission) continue;
  if (!item.url.startsWith("/dashboard") || item.url.includes("[")) continue;
  const pageFile = path.join(ROOT, "app", item.url, "page.tsx");
  if (!fs.existsSync(pageFile)) {
    pageChecks.push({ item, status: "NOT_FOUND", actual: null });
    continue;
  }
  const content = fs.readFileSync(pageFile, "utf8");
  const match = content.match(/requirePermission\(\s*"([^"]+)"\s*\)/);
  if (!match) {
    pageChecks.push({ item, status: "NO_CHECK", actual: null });
    continue;
  }
  const actual = match[1];
  pageChecks.push({ item, status: actual === item.permission ? "OK" : "MISMATCH", actual });
}

// ── Check 3: role coverage matrix ───────────────────────────────────────────

type Role = { label: string; permissions: Set<string> };
const roles: Role[] = [{ label: "owner", permissions: new Set(["*"]) }, { label: "stakeholder", permissions: new Set(stakeholderPerms) }];
for (const [dept, r] of deptRolePerms) {
  roles.push({ label: `${dept}:manager`, permissions: new Set(r.manager) });
  roles.push({ label: `${dept}:member`, permissions: new Set(r.member) });
}

function roleCan(role: Role, permission: string): boolean {
  return role.permissions.has("*") || role.permissions.has(permission);
}

const gatedNavItems = navItems.filter((i) => i.permission);
const orphanedNavItems = gatedNavItems.filter((i) => !roles.some((r) => roleCan(r, i.permission!)));

const grantedByAnyBuiltInRole = new Set<string>();
for (const r of roles) for (const p of r.permissions) grantedByAnyBuiltInRole.add(p);
const orphanedPermissionKeys = [...canonicalKeys].filter((k) => !grantedByAnyBuiltInRole.has(k));

// ── Output ───────────────────────────────────────────────────────────────

console.log(`Loaded ${canonicalKeys.size} canonical permission keys, ${navItems.length} nav items, ${roles.length} built-in roles.\n`);

console.log(`=== Unknown permission keys (${unknownKeyFindings.length}) ===`);
if (unknownKeyFindings.length === 0) console.log("None — every key used resolves to ALL_PERMISSIONS or APPROVAL_ONLY_KEYS.\n");
else { for (const f of unknownKeyFindings) console.log(`  ${f}`); console.log(""); }

const mismatches = pageChecks.filter((c) => c.status === "MISMATCH");
const noChecks = pageChecks.filter((c) => c.status === "NO_CHECK");
console.log(`=== Nav permission vs. page guard (${pageChecks.length} pages checked) ===`);
if (mismatches.length === 0) console.log("No mismatches — every nav-gated page's requirePermission() matches its nav entry.");
else {
  console.log(`${mismatches.length} MISMATCH(es):`);
  for (const m of mismatches) {
    console.log(`  [${m.item.group}] "${m.item.title}" (${m.item.url})`);
    console.log(`    nav.ts gates on:  ${m.item.permission}`);
    console.log(`    page requires:    ${m.actual}`);
  }
}
if (noChecks.length > 0) {
  console.log(`\n${noChecks.length} page(s) gated in nav.ts but with no requirePermission() call found in page.tsx (may use a custom/manual check — verify by hand):`);
  for (const c of noChecks) console.log(`  [${c.item.group}] "${c.item.title}" (app${c.item.url}/page.tsx) — nav requires ${c.item.permission}`);
}
console.log("");

console.log(`=== Nav items unreachable by any built-in role (${orphanedNavItems.length}) ===`);
console.log("(only reachable via owner's \"*\" or a manual per-user permission grant)");
if (orphanedNavItems.length === 0) console.log("None.\n");
else { for (const i of orphanedNavItems) console.log(`  [${i.group}] "${i.title}" — requires ${i.permission}`); console.log(""); }

if (verbose) {
  console.log(`=== Permission keys granted by no built-in role (${orphanedPermissionKeys.length}) ===`);
  for (const k of orphanedPermissionKeys) console.log(`  ${k}`);
  console.log("");

  console.log("=== Role -> visible nav items matrix ===");
  for (const role of roles) {
    const visible = gatedNavItems.filter((i) => roleCan(role, i.permission!)).map((i) => i.title);
    console.log(`  ${role.label} (${role.permissions.has("*") ? "all" : role.permissions.size + " perms"}): ${visible.join(", ") || "(none)"}`);
  }
} else {
  console.log(`${orphanedPermissionKeys.length} permission key(s) granted by no built-in role (often fine — custom/admin-only grants — re-run with --verbose for the list and the full role -> nav matrix).`);
}

if (unknownKeyFindings.length > 0 || mismatches.length > 0) process.exitCode = 1;
